/**
 * Little synthesized sounds (no audio files to download, N-05). Each takes the shared
 * AudioContext and a volume 0..1, already mixed by the caller (audience level during songs).
 */
let noise: AudioBuffer | undefined;
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noise || noise.sampleRate !== ctx.sampleRate) {
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** A filtered noise burst: maracas, claps, tambourine jingles. */
export function hit(ctx: AudioContext, freq: number, q: number, dur: number, gain: number) {
  if (gain <= 0) return;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(ctx.destination);
  s.start(t);
  s.stop(t + dur + 0.02);
}

/** "Hú hét" (VC-04): a rising whoop with a little crowd hiss. */
export function whoop(ctx: AudioContext, vol: number) {
  if (vol <= 0) return;
  const t0 = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = 'triangle';
  o.frequency.setValueAtTime(380, t0);
  o.frequency.exponentialRampToValueAtTime(950, t0 + 0.35);
  o.frequency.exponentialRampToValueAtTime(700, t0 + 0.7);
  f.type = 'lowpass';
  f.frequency.value = 2200;
  g.gain.setValueAtTime(0.001, t0);
  g.gain.exponentialRampToValueAtTime(0.35 * vol, t0 + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.75);
  o.connect(f).connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + 0.8);
  hit(ctx, 1800, 0.7, 0.5, 0.08 * vol);
}

/** One "shake" of a prop (M-02). The page calls this every few hundred ms per shaking person. */
export function propHit(ctx: AudioContext, prop: string, vol: number) {
  if (prop === 'maracas') hit(ctx, 5200, 1.2, 0.07, 0.35 * vol);
  else if (prop === 'tambourine') {
    hit(ctx, 8000, 0.8, 0.18, 0.25 * vol);
    hit(ctx, 3500, 6, 0.12, 0.12 * vol);
  } else if (prop === 'clap') hit(ctx, 1400, 1.5, 0.09, 0.5 * vol);
}
/** Milliseconds between two hits, per prop (lightsticks are silent). */
export const PROP_GAP_MS: Record<string, number> = { maracas: 125, tambourine: 160, clap: 190 };

function tone(ctx: AudioContext, freq: number, dur: number, type: OscillatorType, gain: number, delay = 0) {
  const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + delay;
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** FM-01: the countdown beeps ("1, 2, 3") and the glasses clinking on "DÔ!". */
export function countBeep(ctx: AudioContext, vol: number) {
  if (vol > 0) tone(ctx, 880, 0.12, 'sine', 0.15 * vol);
}
export function clink(ctx: AudioContext, vol: number) {
  if (vol <= 0) return;
  [2637, 3136, 3951, 2093].forEach((f, i) => tone(ctx, f, 0.6, 'sine', 0.08 * vol, i * 0.03));
  hit(ctx, 6000, 2, 0.15, 0.1 * vol);
}

/** FM-05: a cartoon fart (a wobbling low buzz). */
export function fartSound(ctx: AudioContext, vol: number) {
  if (vol <= 0) return;
  const t0 = ctx.currentTime, dur = 0.75;
  const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lfoGain = ctx.createGain(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(95, t0);
  o.frequency.exponentialRampToValueAtTime(55, t0 + dur);
  lfo.frequency.value = 22;
  lfoGain.gain.value = 18;
  lfo.connect(lfoGain).connect(o.frequency);
  f.type = 'lowpass';
  f.frequency.value = 420;
  g.gain.setValueAtTime(0.001, t0);
  g.gain.exponentialRampToValueAtTime(0.5 * vol, t0 + 0.04);
  g.gain.setValueAtTime(0.5 * vol, t0 + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(f).connect(g).connect(ctx.destination);
  o.start(t0);
  lfo.start(t0);
  o.stop(t0 + dur + 0.05);
  lfo.stop(t0 + dur + 0.05);
}
