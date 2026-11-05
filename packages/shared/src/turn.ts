import { z } from 'zod';
import { expectedPosition } from './index.js';
import type { PlaybackState } from './index.js';
import type { QueueEntry } from './queue.js';

/** Extra seconds given after the expected end before the server ends the song (Y-11). */
export const SONG_END_GRACE_SEC = 2;

/** How long a disconnected member keeps their seat, queue entries and vote (N-12, R-09). */
export const AWAY_GRACE_MS = 20_000;

export interface TurnState {
  entry: QueueEntry;
  startedAtServerMs: number;
  /** Server time the song is expected to end; null when the duration is unknown. */
  endsAtServerMs: number | null;
  /** Set when the singer dropped: the SONG ends at this moment unless kept or taken over (R-09).
   *  It never reserves the stage — anyone may step up straight away. */
  singerAwayUntilMs: number | null;
  /** Someone pressed "Giữ bài": the song finishes even with no singer. */
  kept: boolean;
}

/**
 * Milliseconds until the song should end by itself (Y-11), or `null` when it cannot end on its
 * own: no song playing, paused, or the duration is not known yet (the client reports it once the
 * YouTube player loads it — see `PlayDurationInput`). May be ≤ 0, meaning "end now".
 */
export function msUntilSongEnd(p: PlaybackState, nowMs: number, graceSec = SONG_END_GRACE_SEC): number | null {
  if (!p.song || p.paused || p.song.durationSec == null) return null;
  const remainingSec = p.song.durationSec + graceSec - expectedPosition(p, nowMs);
  return remainingSec * 1000;
}

export const PlayDurationInput = z.object({
  rev: z.number().int().nonnegative(),
  durationSec: z.number().min(5).max(7200),
});
export type PlayDurationInput = z.infer<typeof PlayDurationInput>;

export const PlayErrorInput = z.object({
  rev: z.number().int().nonnegative(),
  code: z.number().int(),
});
export type PlayErrorInput = z.infer<typeof PlayErrorInput>;
