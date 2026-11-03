import { decideCorrection, followerTarget, learnSeekLead, percentileAbs, RULES } from './sync-math';

describe('sync maths', () => {
  it('a listener plays the music as late as the singer voice arrives', () => {
    // Singer was at 30.0 s at server time 1000 ms. It is now 1200 ms; voice arrives 150 ms late.
    const t = followerTarget({ pos: 30, atServerMs: 1000, playing: true, rev: 1 }, 1200, 0.15);
    expect(t).toBeCloseTo(30.05, 5);
  });

  it('also waits for how late the singer hears the music, and for my fine-tune', () => {
    // Singer hears their music 45 ms late (sound card + mic); I nudged the slider +20 ms.
    const msg = { pos: 30, atServerMs: 1000, playing: true, rev: 1, lagSec: 0.045 };
    expect(followerTarget(msg, 1200, 0.15, 0.02)).toBeCloseTo(30 + 0.2 - 0.15 - 0.045 - 0.02, 5);
  });

  it('does not move the target forward while the singer is paused', () => {
    expect(followerTarget({ pos: 30, atServerMs: 1000, playing: false, rev: 1 }, 5000, 0.1)).toBeCloseTo(29.9, 5);
  });

  const base = { target: 10, msSinceLastSeek: 60_000, seekLeadSec: 0.15 };

  it('YouTube in server mode only jumps when more than 1 s off (Y-04)', () => {
    expect(decideCorrection({ ...base, errorSec: 0.8, mode: 'server', canChangeRate: false }).kind).toBe('none');
    expect(decideCorrection({ ...base, errorSec: 1.2, mode: 'server', canChangeRate: false })).toEqual({ kind: 'seek', to: 10.15 });
  });

  it('YouTube in follow mode jumps above 0.15 s, but not more than once every 8 s (Y-05)', () => {
    expect(decideCorrection({ ...base, errorSec: 0.1, mode: 'follow', canChangeRate: false }).kind).toBe('none');
    expect(decideCorrection({ ...base, errorSec: -0.2, mode: 'follow', canChangeRate: false }).kind).toBe('seek');
    expect(decideCorrection({ ...base, errorSec: 0.2, mode: 'follow', canChangeRate: false, msSinceLastSeek: 5000 }).kind).toBe('none');
  });

  it('learns how far ahead to jump from what is left after a jump', () => {
    expect(learnSeekLead(0.15, 0.1)).toBeCloseTo(0.2);
    expect(learnSeekLead(0.15, -0.1)).toBeCloseTo(0.1);
    expect(learnSeekLead(0.1, -1)).toBe(0);
  });

  it('the test track speeds up a little when behind, slows down when ahead', () => {
    const behind = decideCorrection({ ...base, errorSec: 0.04, mode: 'follow', canChangeRate: true });
    expect(behind).toEqual({ kind: 'rate', rate: 1.02 });
    const ahead = decideCorrection({ ...base, errorSec: -0.2, mode: 'follow', canChangeRate: true });
    expect(ahead).toEqual({ kind: 'rate', rate: 1 - RULES.rate.maxDelta });
    expect(decideCorrection({ ...base, errorSec: 0.01, mode: 'follow', canChangeRate: true }).kind).toBe('none');
    expect(decideCorrection({ ...base, errorSec: 0.5, mode: 'follow', canChangeRate: true }).kind).toBe('seek');
  });

  it('percentiles use absolute values', () => {
    expect(percentileAbs([-0.1, 0.02, 0.05, -0.03], 50)).toBe(0.05);
    expect(percentileAbs([], 90)).toBeNaN();
  });
});
