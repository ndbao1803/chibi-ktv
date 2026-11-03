import { TEST_TRACK_BPM } from '@ktv/shared';
import type { KtvPlayer } from './ktv-player';

const BEAT = 60 / TEST_TRACK_BPM;
const LOOKAHEAD = 0.25;

/**
 * A built-in metronome made with Web Audio: a click on every beat, a higher click on beat 1.
 * Its position is computed from the audio clock, so it is exact; it lets you test sync on two
 * laptops side by side (the clicks must sound together) without YouTube.
 */
export class ClickTrackPlayer implements KtvPlayer {
  readonly ready = true;
  readonly canChangeRate = true;
  private anchorCtx = 0;
  private anchorPos = 0;
  private rate = 1;
  private playing = false;
  private nextBeat = 0;
  private gain: GainNode;
  private scheduled: OscillatorNode[] = [];
  private timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly ctx: AudioContext,
    readonly durationSec: number,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.5;
    this.gain.connect(ctx.destination);
    this.timer = setInterval(() => this.schedule(), 50);
  }

  position() {
    const p = this.playing ? this.anchorPos + (this.ctx.currentTime - this.anchorCtx) * this.rate : this.anchorPos;
    return Math.min(p, this.durationSec);
  }
  isPlaying() {
    return this.playing;
  }
  isWaiting() {
    return false;
  }
  /** Current beat: 0-based beat index, for the on-screen counter. */
  beat() {
    return Math.floor(this.position() / BEAT + 1e-6);
  }

  play() {
    if (this.playing) return;
    this.anchorCtx = this.ctx.currentTime;
    this.playing = true;
    this.reset();
  }
  pause() {
    if (!this.playing) return;
    this.anchorPos = this.position();
    this.playing = false;
    this.reset();
  }
  seek(sec: number) {
    this.anchorPos = Math.max(0, Math.min(sec, this.durationSec));
    this.anchorCtx = this.ctx.currentTime;
    this.reset();
  }
  setRate(rate: number) {
    if (rate === this.rate) return;
    this.anchorPos = this.position();
    this.anchorCtx = this.ctx.currentTime;
    this.rate = rate;
    this.reset();
  }
  setVolume(v: number) {
    this.gain.gain.value = Math.max(0, Math.min(1, v / 100)) * 0.5;
  }
  destroy() {
    clearInterval(this.timer);
    this.cancel();
    this.gain.disconnect();
  }

  private reset() {
    this.cancel();
    this.nextBeat = Math.ceil(this.position() / BEAT - 1e-6);
    this.schedule();
  }
  private cancel() {
    for (const o of this.scheduled) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    this.scheduled = [];
  }
  /** Schedules the clicks that fall in the next 250 ms of song time. */
  private schedule() {
    if (!this.playing) return;
    const horizon = this.position() + LOOKAHEAD * this.rate;
    while (this.nextBeat * BEAT <= Math.min(horizon, this.durationSec)) {
      const at = this.anchorCtx + (this.nextBeat * BEAT - this.anchorPos) / this.rate;
      if (at >= this.ctx.currentTime - 0.005) this.click(Math.max(at, this.ctx.currentTime), this.nextBeat % 4 === 0);
      this.nextBeat++;
    }
    this.scheduled = this.scheduled.filter((o) => (o as OscillatorNode & { _end: number })._end > this.ctx.currentTime);
  }
  private click(at: number, accent: boolean) {
    const o = this.ctx.createOscillator() as OscillatorNode & { _end: number };
    const g = this.ctx.createGain();
    o.frequency.value = accent ? 1760 : 1100;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(accent ? 1 : 0.6, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    o.connect(g).connect(this.gain);
    o.start(at);
    o.stop(at + 0.06);
    o._end = at + 0.06;
    this.scheduled.push(o);
  }
}
