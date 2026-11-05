/**
 * KTV echo for the singer's voice (S-04): a short repeating echo (like the "ECHO" knob on a
 * karaoke mixer) plus a little room reverb. Plain Web Audio, no files to download.
 *
 *   input ─┬──────────── dry ──────────────┐
 *          ├─ delay ⟲ feedback → lowpass ─ wet ─┤→ output
 *          └─ reverb (made-up room) ─ wet ───┘
 */
export type EchoLevel = 0 | 1 | 2 | 3;
export const ECHO_LABELS: Record<EchoLevel, string> = { 0: 'Tắt', 1: 'Nhẹ', 2: 'Vừa', 3: 'KTV' };

/** Delay time (s), how much each repeat feeds the next, and how loud echo and reverb are. */
export const ECHO_PRESETS: Record<EchoLevel, { delay: number; feedback: number; echo: number; reverb: number }> = {
  0: { delay: 0.12, feedback: 0, echo: 0, reverb: 0 },
  1: { delay: 0.12, feedback: 0.2, echo: 0.22, reverb: 0.12 },
  2: { delay: 0.16, feedback: 0.32, echo: 0.32, reverb: 0.2 },
  3: { delay: 0.2, feedback: 0.45, echo: 0.42, reverb: 0.3 },
};

export interface Echo {
  input: AudioNode;
  output: AudioNode;
  set(level: EchoLevel): void;
  disconnect(): void;
}

let impulse: AudioBuffer | undefined;
/** A made-up 1.2 s room: decaying noise, a little different on each ear. */
function roomImpulse(ctx: BaseAudioContext): AudioBuffer {
  if (impulse && impulse.sampleRate === ctx.sampleRate) return impulse;
  const len = Math.round(ctx.sampleRate * 1.2);
  impulse = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = impulse.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return impulse;
}

/** `dry: false` gives only the echo and reverb: for the singer's own headphones (they hear their real voice already). */
export function createEcho(ctx: AudioContext, dry = true): Echo {
  const input = ctx.createGain(), output = ctx.createGain();
  const dryGain = ctx.createGain(), delay = ctx.createDelay(1), feedback = ctx.createGain();
  const tone = ctx.createBiquadFilter(), echoGain = ctx.createGain(), reverb = ctx.createConvolver(), reverbGain = ctx.createGain();
  dryGain.gain.value = dry ? 1 : 0;
  tone.type = 'lowpass';
  tone.frequency.value = 3200; // each repeat a bit darker, like a real echo
  reverb.buffer = roomImpulse(ctx);
  input.connect(dryGain).connect(output);
  input.connect(delay);
  delay.connect(tone);
  tone.connect(feedback).connect(delay);
  tone.connect(echoGain).connect(output);
  input.connect(reverb).connect(reverbGain).connect(output);
  const set = (level: EchoLevel) => {
    const p = ECHO_PRESETS[level], t = ctx.currentTime;
    delay.delayTime.setTargetAtTime(p.delay, t, 0.05);
    feedback.gain.setTargetAtTime(p.feedback, t, 0.05);
    echoGain.gain.setTargetAtTime(p.echo, t, 0.05);
    reverbGain.gain.setTargetAtTime(p.reverb, t, 0.05);
  };
  set(0);
  return { input, output, set, disconnect: () => [input, output, dryGain, delay, feedback, tone, echoGain, reverb, reverbGain].forEach((n) => n.disconnect()) };
}
