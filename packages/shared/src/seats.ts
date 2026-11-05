import { z } from 'zod';

/**
 * Seats (R-04, R-11..R-13). The room has 16 numbered places; a room of 8 uses only the first 8.
 *  0–3  back sofa, left to right (facing the stage)
 *  4, 7 right sofa (front, back) · 5, 6 left sofa (back, front)
 *  8–15 bar stools behind the back sofa, for rooms of 16
 */
export const SEAT_COUNT = 16;

/** Who gets which seat on arrival: side sofas first (the default camera sees their faces). */
export const SEAT_FILL_ORDER = [6, 4, 5, 7, 1, 2, 0, 3, 11, 12, 10, 13, 9, 14, 8, 15] as const;

export const SeatTakeInput = z.object({ seat: z.number().int().min(0).max(SEAT_COUNT - 1) });
export type SeatTakeInput = z.infer<typeof SeatTakeInput>;

/** First free seat in fill order, or null when every seat of this room size is taken. */
export function firstFreeSeat(taken: ReadonlySet<number>, capacity: number): number | null {
  for (const s of SEAT_FILL_ORDER) if (s < capacity && !taken.has(s)) return s;
  return null;
}
