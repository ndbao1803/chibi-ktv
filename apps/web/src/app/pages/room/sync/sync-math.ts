import type { SingerPosition } from '@ktv/shared';

/**
 * The sync rules, as pure functions so they can be unit-tested.
 *
 * Two modes:
 *  - "server": nobody is singing, or I am the singer. Follow the server clock loosely (Y-04).
 *  - "follow": someone else sings. Play the music exactly as late as their voice reaches me,
 *    so voice and music line up in my ears (Y-05).
 */
export type SyncMode = 'server' | 'follow';

/** A singer position older than this is ignored (connection hiccup); we fall back to the server clock. */
export const SINGER_POSITION_MAX_AGE_MS = 2000;

/**
 * Where my music should be right now when following the singer:
 * the singer's position, moved forward by the time since they read it, minus how late their voice reaches me.
 */
export function followerTarget(msg: SingerPosition, serverNowMs: number, voiceDelaySec: number): number {
  const sinceRead = msg.playing ? (serverNowMs - msg.atServerMs) / 1000 : 0;
  return Math.max(0, msg.pos + sinceRead - voiceDelaySec);
}

export type Correction = { kind: 'none'; rate: 1 } | { kind: 'rate'; rate: number } | { kind: 'seek'; to: number };

export interface CorrectionInput {
  /** target − actual, in seconds. Positive: I am behind. */
  errorSec: number;
  target: number;
  mode: SyncMode;
  /** The test track can change speed smoothly; YouTube can only jump (seek). */
  canChangeRate: boolean;
  msSinceLastSeek: number;
  /** Learned: how long a YouTube seek takes to settle, added to the jump. */
  seekLeadSec: number;
}

/** Thresholds from the requirements: Y-04 (server mode) and Y-05 (follow mode). */
export const RULES = {
  server: { seekAboveSec: 1.0, seekEveryMs: 10_000 },
  // Tighter than the requirement's first draft (0.4 s): the learned seek lead keeps jumps accurate.
  follow: { seekAboveSec: 0.25, seekEveryMs: 5_000 },
  rate: { deadbandSec: 0.02, gain: 0.5, maxDelta: 0.05, seekAboveSec: 0.3 },
} as const;

export function decideCorrection(i: CorrectionInput): Correction {
  const abs = Math.abs(i.errorSec);
  if (i.canChangeRate) {
    // Smooth: big errors jump, small ones are absorbed by playing up to 5% faster or slower.
    if (abs > RULES.rate.seekAboveSec) return { kind: 'seek', to: i.target };
    if (abs < RULES.rate.deadbandSec) return { kind: 'none', rate: 1 };
    const delta = Math.max(-RULES.rate.maxDelta, Math.min(RULES.rate.maxDelta, i.errorSec * RULES.rate.gain));
    return { kind: 'rate', rate: 1 + delta };
  }
  const rule = RULES[i.mode];
  if (abs > rule.seekAboveSec && i.msSinceLastSeek >= rule.seekEveryMs) {
    return { kind: 'seek', to: Math.max(0, i.target + i.seekLeadSec) };
  }
  return { kind: 'none', rate: 1 };
}

/** Exponential moving average, used for the voice delay and the error display. */
export const ema = (prev: number | null, next: number, k = 0.2) => (prev === null ? next : prev + k * (next - prev));

/** p-th percentile (0..100) of absolute values. */
export function percentileAbs(values: number[], p: number): number {
  if (!values.length) return NaN;
  const s = values.map(Math.abs).sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

/**
 * YouTube jumps land a little late (buffering after a seek). After each jump we look at what is
 * left of the error and move the lead halfway towards it, so the next jump lands closer.
 */
export function learnSeekLead(currentLeadSec: number, residualErrorSec: number): number {
  return Math.max(0, Math.min(1, currentLeadSec + residualErrorSec * 0.5));
}
