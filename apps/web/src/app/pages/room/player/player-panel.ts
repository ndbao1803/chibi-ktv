import { Component, computed, effect, ElementRef, inject, OnDestroy, signal, untracked, viewChild } from '@angular/core';
import { expectedPosition, type PlaybackState, type SongRef } from '@ktv/shared';
import { RealtimeService } from '../realtime.service';
import { VoiceService } from '../voice/voice.service';
import { AudioService } from '../audio.service';
import { decideCorrection, ema, followerTarget, learnSeekLead, SINGER_POSITION_MAX_AGE_MS, type SyncMode } from '../sync/sync-math';
import type { KtvPlayer } from './ktv-player';
import { ClickTrackPlayer } from './click-track.player';
import { YouTubePlayer } from './youtube.player';

/** Read by the multi-browser sync test (T-01) and handy in the browser console. */
interface SyncProbe {
  role: string;
  mode: SyncMode;
  samplesMs: number[];
  voiceDelayMs: number;
  position: number;
}
declare global {
  interface Window {
    __ktvSync?: SyncProbe;
  }
}

const TICK_MS = 100;
const POSITION_EVERY_MS = 250;

const songKey = (s: SongRef | null) => (s ? `${s.kind}:${s.id}` : '');
const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/**
 * The flat video panel (P-04: never transformed or covered, at least 200×200) and the sync loop.
 * Every 100 ms it compares the player with where it should be and nudges it.
 */
@Component({
  selector: 'app-player-panel',
  templateUrl: './player-panel.html',
  styleUrl: './player-panel.scss',
})
export class PlayerPanel implements OnDestroy {
  private readonly rt = inject(RealtimeService);
  private readonly voice = inject(VoiceService);
  private readonly audio = inject(AudioService);
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');

  private player?: KtvPlayer;
  private loadedKey = '';
  private lastSeekAt = 0;
  private lastSentAt = 0;
  private seekLeadSec = 0.15;
  /** Set right after a YouTube jump: once playback settles, the leftover error teaches the seek lead. */
  private checkSeekAt = 0;
  private errEma: number | null = null;
  private timer = setInterval(() => this.tick(), TICK_MS);
  private probe: SyncProbe = { role: 'idle', mode: 'server', samplesMs: [], voiceDelayMs: 0, position: 0 };

  protected readonly song = computed(() => this.rt.playback().song);
  protected readonly status = signal('');
  protected readonly errorText = signal('');
  protected readonly mode = signal<SyncMode>('server');
  protected readonly syncErrMs = signal<number | null>(null);
  protected readonly time = signal('0:00');
  protected readonly beat = signal(-1);
  protected readonly volume = signal(80);

  constructor() {
    window.__ktvSync = this.probe;
    // A new song (or the sound being unlocked) creates a new player.
    effect(() => {
      const p = this.rt.playback();
      const ready = this.audio.unlocked();
      untracked(() => {
        if (ready && songKey(p.song) !== this.loadedKey) this.load(p);
      });
    });
  }

  setVolume(v: number) {
    this.volume.set(v);
    this.player?.setVolume(v);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
    this.player?.destroy();
  }

  private load(p: PlaybackState) {
    this.player?.destroy();
    this.player = undefined;
    this.host().nativeElement.replaceChildren();
    this.errorText.set('');
    this.loadedKey = songKey(p.song);
    if (!p.song) return;
    const start = expectedPosition(p, this.rt.serverNow());
    if (p.song.kind === 'test') {
      this.player = new ClickTrackPlayer(this.audio.ctx, p.song.durationSec);
      this.player.seek(start);
    } else {
      this.player = new YouTubePlayer(this.host().nativeElement, p.song.id, start, (msg) => this.errorText.set(msg));
    }
    this.player.setVolume(this.volume());
    this.lastSeekAt = 0;
    this.errEma = null;
  }

  /** The sync loop. */
  private tick() {
    const player = this.player;
    const p = this.rt.playback();
    if (!player || !p.song || !player.ready) {
      this.status.set(p.song && !this.audio.unlocked() ? 'Bấm “Vào phòng” để nghe nhạc' : p.song ? 'Đang tải…' : '');
      return;
    }
    const now = this.rt.serverNow();
    const pos = player.position();
    this.time.set(`${fmt(pos)} / ${p.song.durationSec ? fmt(p.song.durationSec) : '--:--'}`);
    if (player instanceof ClickTrackPlayer) this.beat.set(player.beat());

    if (p.paused) {
      if (player.isPlaying()) player.pause();
      if (Math.abs(pos - p.pausedAtSec) > 0.3) player.seek(p.pausedAtSec);
      this.status.set('Tạm dừng');
      return;
    }
    if (now < p.startedAtServerMs) {
      // Everyone starts together: wait at 0 until the agreed moment.
      if (player.isPlaying()) player.pause();
      if (pos > 0.05) player.seek(0);
      this.status.set(`Bắt đầu sau ${Math.ceil((p.startedAtServerMs - now) / 1000)} giây…`);
      return;
    }
    if (p.song.durationSec && expectedPosition(p, now) >= p.song.durationSec) {
      if (player.isPlaying()) player.pause();
      this.status.set('Hết bài');
      return;
    }

    // Which clock do I follow?
    const role = this.voice.role();
    const sp = this.voice.singerPos();
    const fresh = sp && performance.now() - sp.receivedAt < SINGER_POSITION_MAX_AGE_MS && sp.msg.rev === p.rev;
    const mode: SyncMode = role === 'listener' && fresh && this.voice.hearingSinger() ? 'follow' : 'server';
    const target =
      mode === 'follow' ? followerTarget(sp!.msg, now, this.voice.voiceDelaySec()) : expectedPosition(p, now);

    if (!player.isPlaying()) player.play();
    const err = target - pos;
    if (this.checkSeekAt && performance.now() > this.checkSeekAt && player.isPlaying() && !player.isWaiting()) {
      this.seekLeadSec = learnSeekLead(this.seekLeadSec, err);
      this.checkSeekAt = 0;
    }
    const c = decideCorrection({
      errorSec: err,
      target,
      mode,
      canChangeRate: player.canChangeRate,
      msSinceLastSeek: performance.now() - this.lastSeekAt,
      seekLeadSec: this.seekLeadSec,
    });
    if (c.kind === 'seek') {
      player.seek(c.to);
      player.setRate(1);
      this.lastSeekAt = performance.now();
      if (!player.canChangeRate) this.checkSeekAt = performance.now() + 1500;
    } else player.setRate(c.rate);

    // Singer: tell listeners where my music is (Y-05).
    if (role === 'singer' && performance.now() - this.lastSentAt >= POSITION_EVERY_MS) {
      this.voice.sendPosition({ pos, atServerMs: now, playing: player.isPlaying(), rev: p.rev });
      this.lastSentAt = performance.now();
    }

    this.errEma = ema(this.errEma, Math.abs(err) * 1000, 0.1);
    this.syncErrMs.set(Math.round(this.errEma));
    this.mode.set(mode);
    this.status.set(player.isWaiting() ? 'Video đang chờ (quảng cáo hoặc mạng chậm) — sẽ tự bắt nhịp lại' : '');
    this.probe.role = role;
    this.probe.mode = mode;
    this.probe.position = pos;
    this.probe.voiceDelayMs = Math.round(this.voice.voiceDelaySec() * 1000);
    if (mode === 'follow' && this.probe.samplesMs.length < 5000) this.probe.samplesMs.push(err * 1000);
  }
}
