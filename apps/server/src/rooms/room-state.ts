import {
  EMPTY_PLAYBACK,
  expectedPosition,
  SONG_END_GRACE_SEC,
  START_LEAD_MS,
  type PlaybackState,
  type PresenceList,
  type SongRef,
  type StageState,
} from '@ktv/shared';
import { RoomQueue } from './room-queue.js';

interface Member {
  displayName: string;
  sockets: Set<string>;
  joinedAt: number;
}

/** What changed, so the caller (`RoomLiveService`) knows exactly what to broadcast. */
export interface Effects {
  presence?: boolean;
  playback?: boolean;
  stage?: boolean;
  queue?: boolean;
  skip?: boolean;
  notice?: string;
}

/**
 * Everything live about one room, kept in memory: who is here, what is playing, who is singing,
 * and the song queue. Version 1 has no host, so any member may change these.
 */
export class RoomState {
  private readonly members = new Map<string, Member>();
  playback: PlaybackState = { ...EMPTY_PLAYBACK };
  stage: StageState = { singerId: null, singerName: null };
  readonly queue = new RoomQueue();

  constructor(
    readonly code: string,
    private readonly now: () => number = Date.now,
  ) {}

  /* ----- presence ----- */

  addSocket(userId: string, displayName: string, socketId: string) {
    const m = this.members.get(userId) ?? { displayName, sockets: new Set<string>(), joinedAt: this.now() };
    m.sockets.add(socketId);
    this.members.set(userId, m);
  }

  /** Removes one socket. A person with two tabs counts once; returns true when they left completely. */
  removeSocket(userId: string, socketId: string): boolean {
    const m = this.members.get(userId);
    if (!m) return false;
    m.sockets.delete(socketId);
    if (m.sockets.size > 0) return false;
    this.members.delete(userId);
    // TODO phase 05: an away-grace window before any of this fires, and drop their pending queue
    // entries via `this.queue.removeAllOf(userId)` only once the grace actually expires (R-09, N-12).
    if (this.queue.current?.entry.singerId === userId) {
      this.advance(); // the turn's singer is gone for good; move on rather than stall the queue
    } else if (this.stage.singerId === userId) {
      this.stage = { singerId: null, singerName: null };
    }
    return true;
  }

  has(userId: string) {
    return this.members.has(userId);
  }
  get size() {
    return this.members.size;
  }
  get isEmpty() {
    return this.members.size === 0;
  }
  socketsOf(userId: string): string[] {
    return [...(this.members.get(userId)?.sockets ?? [])];
  }
  presence(): PresenceList {
    return [...this.members.entries()]
      .sort((a, b) => a[1].joinedAt - b[1].joinedAt)
      .map(([userId, m]) => ({ userId, displayName: m.displayName, away: false })); // TODO phase 05: real away state
  }

  /* ----- playback ----- */

  setSong(song: SongRef, by: string) {
    this.playback = {
      song,
      startedAtServerMs: this.now() + START_LEAD_MS,
      paused: false,
      pausedAtSec: 0,
      updatedBy: by,
      rev: this.playback.rev + 1,
    };
  }

  pause(by: string): boolean {
    const p = this.playback;
    if (!p.song || p.paused) return false;
    this.playback = { ...p, paused: true, pausedAtSec: expectedPosition(p, this.now()), updatedBy: by, rev: p.rev + 1 };
    return true;
  }

  resume(by: string): boolean {
    const p = this.playback;
    if (!p.song || !p.paused) return false;
    // Restart a little in the future so every browser is ready at the same moment.
    const at = this.now() + 600;
    this.playback = { ...p, paused: false, startedAtServerMs: at - p.pausedAtSec * 1000, updatedBy: by, rev: p.rev + 1 };
    return true;
  }

  /* ----- stage ----- */

  takeStage(userId: string): { ok: true } | { ok: false; error: string } {
    const m = this.members.get(userId);
    if (!m) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    if (this.stage.singerId && this.stage.singerId !== userId) {
      return { ok: false, error: `${this.stage.singerName} đang hát` };
    }
    this.stage = { singerId: userId, singerName: m.displayName };
    return { ok: true };
  }

  /** `stage:leave` by the running turn's singer ends the turn (S-01); by anyone else it is a no-op. */
  leaveStage(userId: string): Effects {
    if (this.queue.current && this.queue.current.entry.singerId === userId) return this.endTurn(userId);
    if (this.stage.singerId !== userId) return {};
    this.stage = { singerId: null, singerName: null };
    return { stage: true };
  }

  /* ----- turns (Q-05, S-01) ----- */

  /** Starts a turn immediately when the queue holds a song and none is running. */
  startTurnIfIdle(): Effects {
    if (this.queue.current) return {};
    return this.advance();
  }

  /** Ends the running turn when `byUserId` is its singer, or unconditionally when `null` (server-forced). */
  endTurn(byUserId: string | null): Effects {
    if (!this.queue.current) return {};
    if (byUserId !== null && this.queue.current.entry.singerId !== byUserId) return {};
    return this.advance();
  }

  /** Clears the current turn and starts the next one; an empty queue idles the room (Y-11). */
  advance(): Effects {
    this.queue.setCurrent(null);
    let next = this.queue.shift();
    while (next && !this.has(next.singerId)) next = this.queue.shift(); // singer already gone; skip them

    if (!next) {
      this.playback = { ...EMPTY_PLAYBACK, rev: this.playback.rev + 1 };
      this.stage = { singerId: null, singerName: null };
      return { playback: true, stage: true, queue: true };
    }

    this.setSong(next.song, next.singerName);
    this.queue.sung(next.singerId);
    this.stage = { singerId: next.singerId, singerName: next.singerName };
    const durationSec = next.song.durationSec;
    this.queue.setCurrent({
      entry: next,
      startedAtServerMs: this.playback.startedAtServerMs,
      endsAtServerMs: durationSec == null ? null : this.playback.startedAtServerMs + (durationSec + SONG_END_GRACE_SEC) * 1000,
      singerAwayUntilMs: null,
      kept: false,
    });
    return { playback: true, stage: true, queue: true };
  }

  /** Every server-time deadline in the room (song end, away grace, vote re-counts) in one place. */
  tick(now: number): Effects {
    void now;
    // TODO phase 04: when `queue.current?.endsAtServerMs` has passed (and the song is not `kept`
    // past a dropped singer), call `this.endTurn(null)` here.
    // TODO phase 05: `singerAwayUntilMs` bookkeeping and the away-grace seat/queue protection.
    return {};
  }
}
