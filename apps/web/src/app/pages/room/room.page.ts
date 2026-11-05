import { Component, computed, effect, ElementRef, inject, input, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { TEST_TRACK_LINK, type HeadphoneKind } from '@ktv/shared';
import { QueuePanel } from './queue/queue-panel';
import { AuthService } from '../../core/auth.service';
import { RealtimeService } from './realtime.service';
import { VoiceService } from './voice/voice.service';
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
  imports: [PlayerPanel, QueuePanel],
  templateUrl: './room.page.html',
  styleUrl: './room.page.scss',
  providers: [RealtimeService, VoiceService], // one connection per visit to a room
})
export class RoomPage implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly rt = inject(RealtimeService);
  protected readonly voice = inject(VoiceService);
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
  protected readonly askHeadphones = signal<'sing' | 'prepare' | null>(null);
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
  }

  ngOnInit() {
    // Join first: the room (music, voice, queue) must work even if 3D does not.
    void this.rt.join(this.code().toUpperCase());
    // ?lite=1 skips the 3D room (slow phones, and the multi-browser sync test).
    if (new URLSearchParams(location.search).has('lite')) return;
    try {
      this.scene = new KtvScene(this.canvas().nativeElement);
      this.scene.levelOf = (id) => (id === this.rt.stage().singerId ? this.voice.singerLevel() : 0);
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
    this.scene?.dispose();
    clearTimeout(this.noticeTimer);
  }

  /** R-03: the click that allows sound in this tab. */
  async enter() {
    await this.audio.unlock();
  }

  /** Who stands on the stage (one now; two for duets in Phase 4). */
  private readonly singerIds = computed(() => (this.rt.stage().singerId ? [this.rt.stage().singerId!] : []), {
    equal: (a, b) => a.join() === b.join(),
  });
  private readonly singerNames = computed(() => (this.rt.stage().singerName ? [this.rt.stage().singerName!] : []), {
    equal: (a, b) => a.join() === b.join(),
  });

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
  ask(mode: 'sing' | 'prepare') {
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
