import { z } from 'zod';
import type { SongRef } from './index.js';
import type { TurnState } from './turn.js';

/** Q-03: an entry is a song plus the singer who queued it (no duet fields — Phase 4). */
export interface QueueEntry {
  id: string;
  song: SongRef;
  singerId: string;
  singerName: string;
  addedAtMs: number;
}

/** Caps so one person cannot fill the whole night (Q-05, Decided #4). */
export const MAX_QUEUE_PER_USER = 5;
export const MAX_QUEUE_TOTAL = 50;

export const QueueAddInput = z.object({ link: z.string().trim().min(1, 'Hãy dán link YouTube').max(300) });
export type QueueAddInput = z.infer<typeof QueueAddInput>;

export const QueueRemoveInput = z.object({ entryId: z.string().uuid('Mã bài hát không hợp lệ') });
export type QueueRemoveInput = z.infer<typeof QueueRemoveInput>;

export interface QueueState {
  current: TurnState | null;
  entries: QueueEntry[];
  rev: number;
}

/**
 * Round-robin order (Q-05): every singer's Nth pending entry gets `round = sung + N`, where `sung`
 * is how many songs they already sang this session and `N` is this entry's index among their own
 * pending entries (0-based, earliest `addedAtMs` first). Entries are then sorted by round, then by
 * `addedAtMs` so the order is stable across every re-broadcast (adding a song never reshuffles the
 * entries already ahead of it).
 */
export function orderQueue(
  entries: readonly QueueEntry[],
  sungCount: ReadonlyMap<string, number> | Record<string, number>,
): QueueEntry[] {
  const sungOf = (singerId: string): number => {
    if (sungCount instanceof Map) return sungCount.get(singerId) ?? 0;
    return (sungCount as Record<string, number>)[singerId] ?? 0;
  };

  const bySinger = new Map<string, QueueEntry[]>();
  for (const entry of [...entries].sort((a, b) => a.addedAtMs - b.addedAtMs)) {
    const own = bySinger.get(entry.singerId) ?? [];
    own.push(entry);
    bySinger.set(entry.singerId, own);
  }

  const roundOf = new Map<string, number>();
  for (const [singerId, own] of bySinger) {
    const base = sungOf(singerId);
    own.forEach((entry, index) => roundOf.set(entry.id, base + index));
  }

  return [...entries].sort((a, b) => {
    const diff = roundOf.get(a.id)! - roundOf.get(b.id)!;
    return diff !== 0 ? diff : a.addedAtMs - b.addedAtMs;
  });
}
