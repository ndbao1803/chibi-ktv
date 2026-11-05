import {
  firstFreeSeat,
  EMPTY_PLAYBACK,
  expectedPosition,
  msUntilSongEnd,
  SONG_END_GRACE_SEC,
  AWAY_GRACE_MS,
  START_LEAD_MS,
  skipDecision,
  type PlaybackState,
  type SkipState,
  type PresenceList,
  type SongRef,
  type StageState,
} from '@ktv/shared';
import { RoomQueue } from './room-queue.js';
import { SkipVotes } from './room-skip.js';

/** YouTube player errors that mean "this video will never play here" (bad id, removed, embedding off). */
const FATAL_PLAYER_ERRORS = new Set([2, 100, 101, 150]);

/** How long a dropped member keeps their seat, queue entries and vote (N-12, R-09; Decided #2). */

interface Member {
  displayName: string;
  sockets: Set<string>;
  joinedAt: number;
  /** All tabs closed (network drop, page reload): still counted, until `awayUntilMs`. */
  away: boolean;
  awayUntilMs: number | null;
  /** Seat number (R-04); kept while away or on stage, freed when they leave for good (R-13). */
  seat: number | null;
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
export { AWAY_GRACE_MS };

export class RoomState {
  private readonly members = new Map<string, Member>();
  playback: PlaybackState = { ...EMPTY_PLAYBACK };
  stage: StageState = { singerId: null, singerName: null };
  readonly queue = new RoomQueue();
  private readonly skips = new SkipVotes();
  /** The skip numbers last broadcast, so we only send `skip:state` when they really change. */
  private lastSkipKey = '0/1/';
  private skipRev = 0;
  /** Number of seats in use: 8 or 16, from the room settings (set on every join). */
  capacity = 16;

  constructor(
    readonly code: string,
    private readonly now: () => number = Date.now,
  ) {}

  /* ----- presence ----- */

  /**
   * Adds a tab. Someone coming back within their away grace keeps their seat, songs and vote;
   * if their turn is still running and nobody took the stage, they get the stage back (R-09).
   */
  addSocket(userId: string, displayName: string, socketId: string): Effects {
    const existing = this.members.get(userId);
    const m: Member = existing ?? {
      displayName,
      sockets: new Set<string>(),
      joinedAt: this.now(),
      away: false,
      awayUntilMs: null,
      seat: firstFreeSeat(this.takenSeats(), this.capacity),
    };
    m.sockets.add(socketId);
    this.members.set(userId, m);
    if (!existing?.away) return {};
    m.away = false;
    m.awayUntilMs = null;
    const turn = this.queue.current;
    if (turn?.entry.singerId === userId && !this.stage.singerId) {
      this.stage = { singerId: userId, singerName: m.displayName };
      this.queue.setCurrent({ ...turn, singerAwayUntilMs: null });
      return { stage: true, queue: true, notice: `${m.displayName} đã kết nối lại` };
    }
    return {};
  }

  /**
   * Removes one tab. A person with two tabs counts once. When their last tab closes they are only
   * marked away for 20 s; returns null while they still have a tab open.
   * If they were singing, the stage opens for anyone, and the song stops after the grace unless
   * someone keeps it ("Giữ bài") or takes the stage (R-09, Decided #3).
   */
  removeSocket(userId: string, socketId: string): Effects | null {
    const m = this.members.get(userId);
    if (!m) return null;
    m.sockets.delete(socketId);
    if (m.sockets.size > 0) return null;
    m.away = true;
    m.awayUntilMs = this.now() + AWAY_GRACE_MS;
    if (this.stage.singerId !== userId) return { presence: true };
    this.stage = { singerId: null, singerName: null };
    const turn = this.queue.current;
    if (turn && !turn.kept) {
      this.queue.setCurrent({ ...turn, singerAwayUntilMs: this.now() + AWAY_GRACE_MS });
      return {
        presence: true,
        stage: true,
        queue: true,
        notice: `${m.displayName} mất kết nối — bài sẽ dừng sau 20 giây. Bấm “Giữ bài” hoặc lên hát tiếp.`,
      };
    }
    return { presence: true, stage: true };
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
      .map(([userId, m]) => ({ userId, displayName: m.displayName, away: m.away, seat: m.seat }));
  }

  /* ----- seats (R-11..R-13) ----- */

  private takenSeats(): Set<number> {
    return new Set([...this.members.values()].flatMap((m) => (m.seat === null ? [] : [m.seat])));
  }

  /**
   * Move to another seat. The server handles one message at a time, so when two people click the
   * same free seat, the first message wins and the second is told (R-13).
   */
  takeSeat(userId: string, seat: number): { ok: true; effects: Effects } | { ok: false; error: string } {
    const m = this.members.get(userId);
    if (!m) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    if (seat >= this.capacity) return { ok: false, error: 'Phòng này không có ghế đó' };
    if (m.seat === seat) return { ok: true, effects: {} };
    for (const [id, other] of this.members) {
      if (id !== userId && other.seat === seat) return { ok: false, error: `${other.displayName} vừa ngồi vào ghế này` };
    }
    m.seat = seat;
    return { ok: true, effects: { presence: true } };
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

  /** Anyone may take an empty stage. Mid-song after the singer dropped, they finish that song. */
  takeStage(userId: string): { ok: true; effects: Effects } | { ok: false; error: string } {
    const m = this.members.get(userId);
    if (!m) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    if (this.stage.singerId && this.stage.singerId !== userId) {
      return { ok: false, error: `${this.stage.singerName} đang hát` };
    }
    const already = this.stage.singerId === userId;
    this.stage = { singerId: userId, singerName: m.displayName };
    const turn = this.queue.current;
    if (turn?.singerAwayUntilMs) {
      this.queue.setCurrent({ ...turn, singerAwayUntilMs: null, kept: true });
      return { ok: true, effects: { stage: true, queue: true, notice: `${m.displayName} lên hát tiếp bài này` } };
    }
    return { ok: true, effects: already ? {} : { stage: true } };
  }

  /** "Giữ bài": the song keeps playing although its singer dropped. It never reserves the stage. */
  keepSong(userId: string): { ok: true; effects: Effects } | { ok: false; error: string } {
    const m = this.members.get(userId);
    if (!m) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    const turn = this.queue.current;
    if (!turn?.singerAwayUntilMs) return { ok: false, error: 'Không có bài nào cần giữ' };
    this.queue.setCurrent({ ...turn, singerAwayUntilMs: null, kept: true });
    return { ok: true, effects: { queue: true, notice: `${m.displayName} đã giữ bài — cả phòng hát tiếp` } };
  }

  /** `stage:leave` by the running turn's singer ends the turn (S-01); by anyone else it is a no-op. */
  leaveStage(userId: string): Effects {
    if (this.queue.current && this.queue.current.entry.singerId === userId) return this.endTurn(userId);
    if (this.stage.singerId !== userId) return {};
    this.stage = { singerId: null, singerName: null };
    return { stage: true };
  }

  /* ----- vote-skip (Q-07) ----- */

  /**
   * Adds or removes the caller's vote to skip the song playing now. Half of the non-singers
   * (rounded up, at least 1) ends the turn. The singer uses "Xuống sân khấu" instead of voting.
   */
  vote(userId: string, vote: boolean): { ok: true; effects: Effects } | { ok: false; error: string } {
    if (!this.queue.current) return { ok: false, error: 'Chưa có bài nào đang phát' };
    if (userId === this.stage.singerId) return { ok: false, error: 'Ca sĩ dùng “Xuống sân khấu” để bỏ bài của mình' };
    if (!this.memberIds().some((id) => id !== this.stage.singerId)) {
      return { ok: false, error: 'Cần ít nhất một người khác trong phòng' };
    }
    if (!this.skips.toggle(userId, vote)) return { ok: true, effects: {} };
    const skipped = this.skipIfVoted();
    if (skipped) return { ok: true, effects: skipped };
    return { ok: true, effects: this.refreshSkip() ? { skip: true } : {} };
  }

  /** What the "Bỏ qua (have/needed)" button shows. Names come from server presence only. */
  skipState(): SkipState {
    const singer = this.stage.singerId;
    const d = skipDecision(this.skips.ids, this.memberIds(), singer);
    const voterNames = this.skips.ids
      .filter((id) => id !== singer && this.members.has(id))
      .map((id) => this.members.get(id)!.displayName);
    return { have: this.queue.current ? d.have : 0, needed: d.needed, voterNames, rev: this.skipRev };
  }

  /** True (and a new `rev`) when the skip numbers changed since the last broadcast, e.g. after a join or leave. */
  refreshSkip(): boolean {
    const s = this.skipState();
    const key = `${s.have}/${s.needed}/${s.voterNames.join(',')}`;
    if (key === this.lastSkipKey) return false;
    this.lastSkipKey = key;
    this.skipRev++;
    return true;
  }

  /** Ends the turn when enough people voted. Also called by the tick, because people leaving can tip it. */
  private skipIfVoted(): Effects | null {
    const turn = this.queue.current;
    if (!turn) return null;
    if (!skipDecision(this.skips.ids, this.memberIds(), this.stage.singerId).skip) return null;
    const title = turn.entry.song.title;
    return { ...this.advance(), notice: `Cả phòng đã bỏ qua bài “${title}”` };
  }

  private memberIds(): string[] {
    return [...this.members.keys()];
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
    this.skips.clear(); // votes belong to one turn; every path to a new song goes through here
    let next = this.queue.shift();
    while (next && !this.has(next.singerId)) next = this.queue.shift(); // singer already gone; skip them

    if (!next) {
      this.playback = { ...EMPTY_PLAYBACK, rev: this.playback.rev + 1 };
      this.stage = { singerId: null, singerName: null };
      return this.withSkip({ playback: true, stage: true, queue: true });
    }

    this.setSong(next.song, next.singerName);
    this.queue.sung(next.singerId);
    // A singer who is away right now gets the same rule as dropping mid-song: open stage, 20 s grace.
    const nextAway = this.members.get(next.singerId)?.away ?? false;
    this.stage = nextAway ? { singerId: null, singerName: null } : { singerId: next.singerId, singerName: next.singerName };
    const durationSec = next.song.durationSec;
    this.queue.setCurrent({
      entry: next,
      startedAtServerMs: this.playback.startedAtServerMs,
      endsAtServerMs: durationSec == null ? null : this.playback.startedAtServerMs + (durationSec + SONG_END_GRACE_SEC) * 1000,
      singerAwayUntilMs: nextAway ? this.members.get(next.singerId)!.awayUntilMs : null,
      kept: false,
    });
    return this.withSkip({ playback: true, stage: true, queue: true });
  }

  /** Adds `skip: true` only when the skip numbers changed, so callers broadcast them too. */
  private withSkip(effects: Effects): Effects {
    return this.refreshSkip() ? { ...effects, skip: true } : effects;
  }

  /* ----- song end and broken videos (Y-11, Y-08) ----- */

  /**
   * A browser reports how long the video is (YouTube tells the player once it loads it). The first
   * plausible report for the song playing now wins; then the server can end the song on time.
   */
  reportDuration(rev: number, durationSec: number): Effects {
    const p = this.playback;
    const turn = this.queue.current;
    if (!turn || !p.song || rev !== p.rev || p.song.durationSec != null) return {};
    const song = { ...p.song, durationSec: Math.round(durationSec) } as typeof p.song;
    this.playback = { ...p, song, rev: p.rev + 1 };
    this.queue.setCurrent({
      ...turn,
      entry: { ...turn.entry, song },
      endsAtServerMs: p.startedAtServerMs + (song.durationSec! + SONG_END_GRACE_SEC) * 1000,
    });
    return { playback: true, queue: true };
  }

  /** The player says this video can never play here (removed, private, embedding off): skip it. */
  reportError(rev: number, code: number): Effects {
    if (!this.queue.current || rev !== this.playback.rev || !FATAL_PLAYER_ERRORS.has(code)) return {};
    return { ...this.advance(), notice: 'Video này không phát được — đã bỏ qua' };
  }

  /** Every server-time deadline in the room (song end, away grace, vote re-counts) in one place. */
  tick(now: number): Effects {
    // N-12: members away longer than the grace leave for good, with their songs and their vote.
    let swept = false;
    for (const [id, m] of this.members) {
      if (m.away && m.awayUntilMs !== null && m.awayUntilMs <= now) {
        this.members.delete(id);
        this.queue.removeAllOf(id);
        this.skips.drop(id);
        swept = true;
      }
    }
    const sweep: Effects = swept ? { presence: true, queue: true } : {};
    // R-09: the singer dropped and nobody kept the song or took over: move on.
    const turn = this.queue.current;
    if (turn?.singerAwayUntilMs && turn.singerAwayUntilMs <= now) {
      return { ...sweep, ...this.advance(), notice: 'Ca sĩ chưa quay lại — chuyển sang bài tiếp theo' };
    }
    // Q-07: people leaving can make the existing votes enough (4 of 8 voted, 3 others left).
    const skipped = this.skipIfVoted();
    if (skipped) return { ...sweep, ...skipped };
    // Y-11: the server, not each browser, decides the song is over (2 s grace for the last frames).
    const left = this.queue.current ? msUntilSongEnd(this.playback, now) : null;
    if (left !== null && left <= 0) {
      const effects = this.advance();
      const next = this.stage.singerName;
      return { ...sweep, ...effects, notice: next ? `Hết bài — tới lượt ${next}` : 'Hết bài' };
    }
    return this.refreshSkip() ? { ...sweep, skip: true } : sweep;
  }
}
