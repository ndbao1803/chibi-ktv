import { Component, computed, effect, ElementRef, inject, input, OnDestroy, OnInit, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { TEST_TRACK_LINK, type FxEvent, type HeadphoneKind } from '@ktv/shared';
import { QueuePanel } from './queue/queue-panel';
import { AuthService } from '../../core/auth.service';
import { RealtimeService } from './realtime.service';
import { VoiceService } from './voice/voice.service';
import { TalkService } from './voice/talk.service';
import { clink, countBeep, fartSound, propHit, PROP_GAP_MS, whoop } from './sounds';
import { ChatPanel } from './chat/chat-panel';
import { PartyBar } from './party/party-bar';
import { ScoreOverlay } from './score/score-overlay';
import { CUNGLY_DO_MS, REACTIONS } from '@ktv/shared';
import { AudioService } from './audio.service';
import { PlayerPanel } from './player/player-panel';
import { KtvScene, type CameraView } from './ktv-scene';

const LOW_POWER_KEY = 'ktv.lowPower';
function readLowPower(): boolean {
  try {
    const saved = localStorage.getItem(LOW_POWER_KEY);
    if (saved !== null) return saved === '1';
  } catch {
    /* storage blocked */
  }
  return matchMedia('(pointer: coarse)').matches;
}

@Component({
  selector: 'app-room-page',
  imports: [PlayerPanel, QueuePanel, ChatPanel, PartyBar, ScoreOverlay],
  templateUrl: './room.page.html',
  styleUrl: './room.page.scss',
  providers: [RealtimeService, VoiceService, TalkService], // one connection per visit to a room
})
export class RoomPage implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly rt = inject(RealtimeService);
  protected readonly voice = inject(VoiceService);
  protected readonly talk = inject(TalkService);
  protected readonly audio = inject(AudioService);
  private readonly router = inject(Router);

  /** From the URL /room/:code (component input binding). */
  readonly code = input.required<string>();
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('scene');
  private scene?: KtvScene;

  protected readonly copied = signal(false);
  /** The browser could not run the 3D room; everything else still works. */
  protected readonly no3d = signal(false);
  protected readonly count = computed(() => this.rt.members().length);
  protected readonly isSinger = computed(() => this.voice.role() === 'singer');
  /** Headphones dialog: 'sing' = go on stage now, 'prepare' = just queued, ask for the mic early (S-02). */
  protected readonly askHeadphones = signal<'sing' | 'prepare' | 'partner' | null>(null);
  protected readonly busy = signal(false);
  protected readonly actionError = signal('');
  private noticeTimer?: ReturnType<typeof setTimeout>;
  protected readonly toast = signal('');

  constructor() {
    // Whenever the member list or the singer changes, update the 3D room.
    effect(() => this.scene?.setCapacity(this.rt.room()?.capacity ?? 8));
    effect(() => this.scene?.setMembers(this.rt.members(), this.auth.user()?.id));
    effect(() => this.scene?.setStage(this.singerIds()));
    effect(() => this.scene?.drawScreen(this.rt.playback().song?.title ?? null, this.singerNames()));
    effect(() => this.flash(this.rt.notice()));
    effect(() => this.flash(this.voice.error()));
    effect(() => this.flash(this.talk.error()));
    // S-12: as the duet partner, my singing mic switches on by itself if I already answered about headphones.
    effect(() => {
      const partner = this.talk.iAmPartner(), kind = this.voice.headphones();
      if (partner && kind !== null && !this.talk.partnerMicOn) void this.talk.startPartnerMic(kind).then(() => this.partnerMic.set(this.talk.partnerMicOn));
      if (!partner) this.partnerMic.set(false);
    });
    this.rt.onFx = (e) => this.onFx(e);
    // Phase 5: who shakes and the crowd dance, everyone's props, chat bubbles, a fresh flower pile per song.
    effect(() => this.scene?.setParty(this.rt.party(), () => this.rt.serverNow()));
    effect(() => this.scene?.setProps(this.rt.members()));
    effect(() => {
      const msgs = this.rt.chat();
      const last = msgs.at(-1);
      untracked(() => {
        if (!last || last.id <= this.bubbled) return;
        // Only bubbles for new lines, not the history loaded on join.
        if (this.bubbled > 0 && last.userId && last.kind !== 'system') this.scene?.say(last.userId, last.kind === 'me' ? `* ${last.text}` : last.text);
        this.bubbled = last.id;
      });
    });
    effect(() => {
      this.rt.playback().song?.id;
      untracked(() => this.scene?.clearFlowers());
    });
  }

  ngOnInit() {
    // Join first: the room (music, voice, queue) must work even if 3D does not.
    void this.rt.join(this.code().toUpperCase());
    // ?lite=1 skips the 3D room (slow phones, and the multi-browser sync test).
    if (new URLSearchParams(location.search).has('lite')) return;
    try {
      this.scene = new KtvScene(this.canvas().nativeElement);
      this.scene.levelOf = (id) =>
        id === this.rt.stage().singerId ? this.voice.singerLevel() : id === this.rt.stage().partnerId ? this.talk.partnerLevel(id) : 0;
      this.scene.talkOf = (id) => this.talk.levelOf(id);
      this.scene.onLost = () => this.no3d.set(true);
      this.scene.onSeatClick = (seat) => void this.changeSeat(seat);
      this.scene.onSlow = () => {
        this.lowPower.set(true);
        this.flash('Máy hơi chậm: đã tắt bớt hiệu ứng trang trí để phòng mượt hơn.');
      };
      if (this.lowPower()) this.scene.setLowPower(true);
      // Effects that ran before the scene existed: draw the current room now.
      this.scene.setCapacity(this.rt.room()?.capacity ?? 8);
      this.scene.setStage(this.singerIds());
      this.scene.setMembers(this.rt.members(), this.auth.user()?.id);
      this.scene.drawScreen(this.rt.playback().song?.title ?? null, this.singerNames());
    } catch (e) {
      console.warn('3D room unavailable, continuing without it', e);
      this.scene = undefined;
      this.no3d.set(true);
    }
  }

  ngOnDestroy() {
    clearInterval(this.micTimer);
    clearInterval(this.nowTimer);
    clearInterval(this.speakTimer);
    clearInterval(this.shakeTimer);
    clearInterval(this.cungTimer);
    this.scene?.dispose();
    clearTimeout(this.noticeTimer);
  }

  /** R-03: the click that allows sound in this tab. */
  async enter() {
    await this.audio.unlock();
  }

  private bubbled = 0;
  /** Phase 5 effects from anyone in the room. */
  private onFx(e: FxEvent) {
    const me = e.userId === this.auth.user()?.id;
    const vol = me ? 0.8 : this.talk.gainFor(e.userId);
    const emoji = (REACTIONS as Record<string, string>)[e.kind];
    if (emoji) this.scene?.react(e.userId, emoji);
    else if (e.kind === 'cheer') {
      this.scene?.cheer(e.userId);
      whoop(this.audio.ctx, vol);
    } else if (e.kind === 'flower') this.scene?.flower(e.userId);
    else if (e.kind === 'cungly') this.startCungLy(e.atMs, e.userId);
    else if (e.kind === 'fart') {
      this.scene?.fart(e.userId);
      // FM-06: half volume while someone sings.
      fartSound(this.audio.ctx, vol * (this.rt.stage().singerId ? 0.5 : 1));
    }
  }

  /** FM-01: "1, 2, 3, DÔ!" timed from the server, so every screen clinks together. */
  protected readonly cungWord = signal('');
  private cung: { doAtMs: number; vol: number } | null = null;
  private startCungLy(atMs: number, by: string) {
    const doAt = atMs + CUNGLY_DO_MS;
    if (doAt - this.rt.serverNow() < -1000) return;
    const name = this.rt.members().find((m) => m.userId === by)?.displayName ?? '';
    this.flash(`${name} mời cả phòng cụng ly!`);
    this.scene?.cungLy(Math.max(0, doAt - this.rt.serverNow()));
    this.cung = { doAtMs: doAt, vol: Math.max(0.3, this.talk.gainFor(by)) };
  }
  /** Reads the countdown from server time every 100 ms, so it never drifts and every screen agrees. */
  private cungTimer = setInterval(() => {
    if (!this.cung) return;
    const left = this.cung.doAtMs - this.rt.serverNow();
    const word = left > 2000 ? '1' : left > 1000 ? '2' : left > 0 ? '3' : left > -1200 ? 'DÔ!' : '';
    if (word === this.cungWord()) return;
    this.cungWord.set(word);
    if (word === 'DÔ!') clink(this.audio.ctx, Math.max(this.cung.vol, 0.5));
    else if (word) countBeep(this.audio.ctx, this.cung.vol);
    else this.cung = null;
  }, 100);

  /** M-02: everyone's shaking makes its prop sound, at the audience level during songs. */
  private lastHit = new Map<string, number>();
  private shakeTimer = setInterval(() => {
    const shakers = this.rt.party().shakers;
    if (!shakers.length || !this.audio.unlocked()) return;
    const now = performance.now(), me = this.auth.user()?.id;
    let sounding = 0;
    for (const id of shakers) {
      if (sounding >= 6) break; // a crowd of 16 maracas is already loud enough
      const prop = this.rt.members().find((m) => m.userId === id)?.prop ?? 'maracas';
      const gap = PROP_GAP_MS[prop];
      if (!gap) continue;
      sounding++;
      if (now - (this.lastHit.get(id) ?? 0) < gap) continue;
      this.lastHit.set(id, now);
      propHit(this.audio.ctx, prop, (id === me ? 0.8 : this.talk.gainFor(id)) * 0.7);
    }
  }, 30);

  /** M-06: the hype meter and the dance (FM-03). */
  protected readonly dancing = computed(() => {
    const until = this.rt.party().danceUntilMs;
    return !!until && until > this.now();
  });

  /** Who stands on the stage (one now; two for duets in Phase 4). */
  private readonly singerIds = computed(() => [this.rt.stage().singerId, this.rt.stage().partnerId].filter((x): x is string => !!x), {
    equal: (a, b) => a.join() === b.join(),
  });
  private readonly singerNames = computed(() => [this.rt.stage().singerName, this.rt.stage().partnerName].filter((x): x is string => !!x), {
    equal: (a, b) => a.join() === b.join(),
  });
  protected readonly isPartner = computed(() => this.talk.iAmPartner());
  /** My duet-partner mic is on. */
  protected readonly partnerMic = signal(false);

  /** S-08: the invite card's seconds left. */
  protected readonly inviteLeft = computed(() => {
    const inv = this.rt.invite();
    return inv ? Math.max(0, Math.ceil((inv.expiresAtMs - this.now()) / 1000)) : 0;
  });
  async answerInvite(yes: boolean) {
    const inv = this.rt.invite();
    if (!inv) return;
    const ack = await this.rt.answerInvite(inv.entryId, yes);
    if (!ack.ok) this.flash(ack.error);
    else if (yes && this.voice.headphones() === null) this.askHeadphones.set('prepare');
  }

  /** VC-04: "Hú hét". The server allows one every 3 seconds. */
  async cheer() {
    const ack = await this.rt.sendFx('cheer');
    if (!ack.ok) this.flash(ack.error);
  }
  async leavePartner() {
    await this.rt.leaveStage();
  }

  /** Who is talking right now (VC-07), refreshed 4 times a second for the member list. */
  protected readonly speaking = signal<ReadonlySet<string>>(new Set());
  private speakTimer = setInterval(() => {
    const now = new Set(this.rt.members().filter((m) => this.talk.levelOf(m.userId) > 0.06).map((m) => m.userId));
    const prev = this.speaking();
    if (now.size !== prev.size || [...now].some((id) => !prev.has(id))) this.speaking.set(now);
  }, 250);

  /** R-11: walk to a free seat. The server decides; if someone was faster, say so. */
  private async changeSeat(seat: number) {
    const ack = await this.rt.takeSeat(seat);
    if (!ack.ok) this.flash(ack.error);
  }

  /** Camera presets (Phase 3). */
  protected readonly view = signal<CameraView>('all');
  setView(v: CameraView) {
    this.view.set(v);
    this.scene?.setView(v);
  }

  /** RD-05: fewer decorations on slow devices. Remembered in this browser; phones start with it on. */
  protected readonly lowPower = signal(readLowPower());
  toggleLowPower() {
    const on = !this.lowPower();
    this.lowPower.set(on);
    this.scene?.setLowPower(on);
    try {
      localStorage.setItem(LOW_POWER_KEY, on ? '1' : '0');
    } catch {
      /* storage blocked: fine, it just is not remembered */
    }
  }

  /** My song was queued. The first time, ask about headphones so the mic can start by itself (S-02). */
  onQueued({ startedNow }: { startedNow: boolean }) {
    if (this.voice.headphones() === null) this.askHeadphones.set(startedNow ? 'sing' : 'prepare');
    else this.flash(startedNow ? 'Đến lượt bạn!' : 'Đã thêm vào danh sách chờ');
  }

  /** Ticks once a second for the singer-away countdown. */
  private readonly now = signal(Date.now());
  private nowTimer = setInterval(() => this.now.set(this.rt.serverNow()), 1000);
  /** R-09: the singer dropped mid-song and nobody has kept it or stepped up yet. */
  protected readonly singerAway = computed(() => {
    const cur = this.rt.queue()?.current;
    if (!cur?.singerAwayUntilMs || cur.kept || this.rt.stage().singerId) return null;
    return { name: cur.entry.singerName, secs: Math.max(0, Math.ceil((cur.singerAwayUntilMs - this.now()) / 1000)) };
  });
  async keepSong() {
    const ack = await this.rt.keepSong();
    if (!ack.ok) this.actionError.set(ack.error);
  }
  async retryMic() {
    this.busy.set(true);
    const err = await this.voice.startSinging(this.voice.headphones() ?? 'wired');
    this.busy.set(false);
    this.voice.autoArmFailed.set(err ?? '');
  }
  ask(mode: 'sing' | 'prepare' | 'partner') {
    this.askHeadphones.set(mode);
  }

  /** The mic meter is off on iPhone (see VoiceService), so its "silent" hint is too. */
  protected readonly isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  /** Singer's own mic meter, so you can see your voice is being picked up (0..100). */
  protected readonly micLevel = signal(0);
  /** Seconds the mic has been silent while singing; after a few, we show a hint. */
  protected readonly micSilentSec = signal(0);
  private micTimer = setInterval(() => {
    if (!this.voice.micOn()) {
      this.micLevel.set(0);
      this.micSilentSec.set(0);
      return;
    }
    const level = Math.round(this.voice.micLevel() * 100);
    this.micLevel.set(level);
    this.micSilentSec.set(level > 2 ? 0 : this.micSilentSec() + 0.2);
  }, 200);
  /** The built-in click track plays at once for everyone (no queue). */
  async playTestTrack() {
    this.actionError.set('');
    this.busy.set(true);
    const ack = await this.rt.setSong(TEST_TRACK_LINK);
    this.busy.set(false);
    if (!ack.ok) this.actionError.set(ack.error);
  }
  async togglePause() {
    const ack = this.rt.playback().paused ? await this.rt.resume() : await this.rt.pause();
    if (!ack.ok) this.actionError.set(ack.error);
  }

  /** S-05: singers say which headphones they use; without any, echo cancellation stays on. */
  async answer(kind: HeadphoneKind) {
    const mode = this.askHeadphones();
    this.askHeadphones.set(null);
    if (mode === 'partner') {
      this.voice.headphones.set(kind);
      const err = await this.talk.startPartnerMic(kind);
      this.partnerMic.set(this.talk.partnerMicOn);
      if (err) this.flash(`Không mở được micro (${err}).`);
      return;
    }
    this.busy.set(true);
    // 'prepare' only asks for permission now. If my turn already began meanwhile, sing straight away.
    const err = mode === 'prepare' && !this.isSinger() ? await this.voice.prepareMic(kind) : await this.voice.startSinging(kind);
    if (mode === 'prepare' && !err) {
      this.busy.set(false);
      this.flash('Xong! Tới lượt bạn, micro sẽ tự bật.');
      return;
    }
    this.busy.set(false);
    if (err) this.actionError.set(err);
    else if (kind === 'none') this.flash('Không có tai nghe: nhạc có thể lọt vào micro. Đeo tai nghe có dây sẽ hay hơn.');
    else if (kind === 'bluetooth') this.flash('Tai nghe Bluetooth: đã bù thêm 0,2 giây cho người nghe.');
  }

  /** Listener fine-tune: positive = the music plays later, so the voice lands earlier against it. */
  protected singerLagMs = computed(() => Math.round((this.voice.singerPos()?.msg.lagSec ?? 0) * 1000));
  async stopSinging() {
    await this.voice.stopSinging();
  }

  async copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      /* clipboard blocked; the code is still visible */
    }
  }

  leave() {
    void this.router.navigate(['/lobby']);
  }

  private flash(text: string) {
    if (!text) return;
    this.toast.set(text);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.toast.set(''), 3500);
  }
}
