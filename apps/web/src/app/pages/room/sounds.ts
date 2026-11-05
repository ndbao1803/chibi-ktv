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
