/**
 * Who has voted to skip the song playing now (Q-07). Only ids; the threshold maths lives in the
 * shared `skipDecision` so the browser can show the same numbers. No clock, no I/O.
 */
export class SkipVotes {
  private readonly voters = new Set<string>();

  /** Adds or removes one vote. Returns true when the tally actually changed (so we don't spam broadcasts). */
  toggle(userId: string, vote: boolean): boolean {
    const had = this.voters.has(userId);
    if (vote === had) return false;
    if (vote) this.voters.add(userId);
    else this.voters.delete(userId);
    return true;
  }

  /** A voter left the room for good. */
  drop(userId: string): boolean {
    return this.voters.delete(userId);
  }

  /** A new turn (or no turn) starts with no votes. */
  clear(): boolean {
    const had = this.voters.size > 0;
    this.voters.clear();
    return had;
  }

  get ids(): string[] {
    return [...this.voters];
  }
}
