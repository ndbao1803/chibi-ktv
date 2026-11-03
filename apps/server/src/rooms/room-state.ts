import {
  EMPTY_PLAYBACK,
  expectedPosition,
  START_LEAD_MS,
  type PlaybackState,
  type PresenceList,
  type SongRef,
  type StageState,
} from '@ktv/shared';

interface Member {
  displayName: string;
  sockets: Set<string>;
  joinedAt: number;
}

/**
 * Everything live about one room, kept in memory: who is here, what is playing, who is singing.
 * Version 1 has no host, so any member may change these.
 */
export class RoomState {
  private readonly members = new Map<string, Member>();
  playback: PlaybackState = { ...EMPTY_PLAYBACK };
  stage: StageState = { singerId: null, singerName: null };

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
    if (this.stage.singerId === userId) this.stage = { singerId: null, singerName: null };
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
      .map(([userId, m]) => ({ userId, displayName: m.displayName }));
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

  leaveStage(userId: string): boolean {
    if (this.stage.singerId !== userId) return false;
    this.stage = { singerId: null, singerName: null };
    return true;
  }
}
