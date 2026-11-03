import { z } from 'zod';

/** Plain 50% of non-singing members, no minimum-vote floor (Q-07, Decided #1). */
export const SKIP_RATIO = 0.5;

export const SkipVoteInput = z.object({ vote: z.boolean() });
export type SkipVoteInput = z.infer<typeof SkipVoteInput>;

export interface SkipState {
  have: number;
  needed: number;
  voterNames: string[];
  rev: number;
}

/**
 * Vote-skip decision (Q-07): eligible voters are every member except the singer. Votes from
 * non-members or the singer are ignored. `needed` rounds up, minimum 1.
 */
export function skipDecision(
  voterIds: readonly string[],
  memberIds: readonly string[],
  singerId: string | null,
): { have: number; needed: number; skip: boolean } {
  const eligible = memberIds.filter((id) => id !== singerId);
  const eligibleSet = new Set(eligible);
  const have = new Set(voterIds.filter((id) => eligibleSet.has(id))).size;
  const needed = Math.max(1, Math.ceil(eligible.length * SKIP_RATIO));
  const skip = eligible.length > 0 && have >= needed;
  return { have, needed, skip };
}
