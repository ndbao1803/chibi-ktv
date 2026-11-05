import {
  CHAT_HISTORY,
  CHAT_RATE,
  DANCE_MS,
  FX_COOLDOWN_MS,
  FX_HYPE,
  RATING_CLOSE_AFTER_MS,
  RATING_OPEN_BEFORE_MS,
  SHAKE_MAX_PER_SEC,
  computeScore,
  scoreComment,
  type ChatMessage,
  type FxKind,
  type LeaderboardRow,
  type PartyState,
  type RatingState,
  type ScoreResult,
} from '@ktv/shared';
import { cleanText } from './profanity.js';

/** Hype the meter loses per second, and what each shaker adds per second (M-06). */
const HYPE_DECAY_PER_SEC = 0.04;
const HYPE_PER_SHAKER_PER_SEC = 0.05;

interface Rating {
  state: RatingState;
  /** userId → stars (G-03); singers are never in here (G-06). */
  votes: Map<string, number>;
  peakHype: number;
  /** Opens at this server time (30 s before the end), so votes before it are refused. */
  opensAtMs: number;
}

/**
 * The party layer of one room (Phase 5): who shakes, the hype meter and crowd dance, effect
 * cooldowns, chat history, the rating window and the night's leaderboard. Pure bookkeeping with an
 * injected clock, like `RoomState`, which owns one of these and turns the results into broadcasts.
 */
export class RoomParty {
  private hype = 0;
  private peakHype = 0;
  private danceUntilMs: number | null = null;
  private readonly shakers = new Set<string>();
  private readonly shakeTimes = new Map<string, number[]>();
  private readonly fxAt = new Map<string, number>(); // `${userId}:${kind}` or `room:cungly`
  private readonly chatTimes = new Map<string, number[]>();
  private chat: ChatMessage[] = [];
  private chatId = 0;
  private rev = 0;
  private lastSent = '0|null|'; // the key of an empty party (see changed())
  private rating: Rating | null = null;
  private readonly best = new Map<string, LeaderboardRow>();

  constructor(private readonly now: () => number) {}

  /* ---------- hype, shaking, dance ---------- */

  state(): PartyState {
    return { hype: Math.round(this.hype * 100) / 100, danceUntilMs: this.danceUntilMs, shakers: [...this.shakers], rev: this.rev };
  }

  /** M-03: at most 8 start/stop messages per second per member; extra ones are dropped. */
  setShaking(userId: string, on: boolean): boolean {
    const now = this.now();
    const times = (this.shakeTimes.get(userId) ?? []).filter((t) => now - t < 1000);
    if (times.length >= SHAKE_MAX_PER_SEC) return false;
    times.push(now);
    this.shakeTimes.set(userId, times);
    const had = this.shakers.has(userId);
    if (on) this.shakers.add(userId);
    else this.shakers.delete(userId);
    return had !== on;
  }

  /** Someone left for good: they stop shaking and their rating no longer counts toward their own song. */
  forget(userId: string) {
    this.shakers.delete(userId);
  }

  /** Cooldowns per person (and per room for cụng ly). Returns an error, or null when allowed. */
  tryFx(userId: string, kind: FxKind): string | null {
    const now = this.now();
    const key = kind === 'cungly' ? 'room:cungly' : `${userId}:${kind}`;
    const last = this.fxAt.get(key) ?? -Infinity;
    if (now - last < FX_COOLDOWN_MS[kind]) {
      if (kind === 'cungly') return 'Vừa cụng ly xong — đợi một chút nhé';
      if (kind === 'fart') return 'Xì hơi 2 phút một lần thôi 😅';
      return 'Chậm lại một chút nhé';
    }
    this.fxAt.set(key, now);
    this.addHype(FX_HYPE[kind]);
    return null;
  }

  private addHype(v: number) {
    if (this.danceUntilMs) return; // the meter refills after the dance
    this.hype = Math.min(1, this.hype + v);
    this.peakHype = Math.max(this.peakHype, this.hype);
  }

  /** Once a second. Returns true when the party state changed enough to broadcast. */
  tick(dtSec: number): boolean {
    const now = this.now();
    if (this.danceUntilMs && now >= this.danceUntilMs) this.danceUntilMs = null;
    const wasFull = this.hype >= 1; // filled by a cụng ly or flowers since the last tick
    if (!this.danceUntilMs) {
      const net = (this.shakers.size * HYPE_PER_SHAKER_PER_SEC - HYPE_DECAY_PER_SEC) * dtSec;
      this.hype = Math.max(0, Math.min(1, this.hype + net));
      this.peakHype = Math.max(this.peakHype, this.hype);
    }
    // FM-03: a full meter starts the crowd dance; the meter drops back to a quarter.
    if ((wasFull || this.hype >= 1) && !this.danceUntilMs) {
      this.danceUntilMs = now + DANCE_MS;
      this.hype = 0.25;
    }
    return this.changed();
  }

  /** True when what a client sees has changed since the last broadcast. */
  changed(): boolean {
    const key = `${Math.round(this.hype * 50)}|${this.danceUntilMs}|${[...this.shakers].sort().join()}`;
    if (key === this.lastSent) return false;
    this.lastSent = key;
    this.rev++;
    return true;
  }

  /* ---------- chat (CH-01..CH-04, CH-11) ---------- */

  history(): ChatMessage[] {
    return this.chat;
  }

  /** A member's message after the rate limit and the word filter, or an error. */
  say(userId: string, name: string, text: string): { ok: true; msg: ChatMessage } | { ok: false; error: string } {
    const now = this.now();
    const times = (this.chatTimes.get(userId) ?? []).filter((t) => now - t < CHAT_RATE.perMs);
    if (times.length >= CHAT_RATE.count) return { ok: false, error: 'Bạn nhắn nhanh quá — đợi vài giây nhé' };
    times.push(now);
    this.chatTimes.set(userId, times);
    const me = /^\/me\s+(.+)/i.exec(text);
    return { ok: true, msg: this.push(me ? 'me' : 'user', userId, name, cleanText(me ? me[1] : text)) };
  }

  /** Room news in the same stream (CH-04). */
  system(text: string): ChatMessage {
    return this.push('system', null, '', text);
  }

  private push(kind: ChatMessage['kind'], userId: string | null, name: string, text: string): ChatMessage {
    const msg: ChatMessage = { id: ++this.chatId, kind, userId, name, text, atMs: this.now() };
    this.chat = [...this.chat, msg].slice(-CHAT_HISTORY);
    return msg;
  }

  /* ---------- rating (G-01..G-03, G-05, G-06) ---------- */

  /** A new turn started: remember who sings, so the window can open later. Resets the peak hype. */
  startTurn(turnKey: string, title: string, singerIds: string[], singerNames: string[], endsAtMs: number | null) {
    this.peakHype = this.hype;
    const closes = (endsAtMs ?? Number.MAX_SAFE_INTEGER - RATING_CLOSE_AFTER_MS) + RATING_CLOSE_AFTER_MS;
    this.pending = { turnKey, title, singerIds, singerNames, closesAtMs: closes, count: 0 };
    this.pendingOpensAt = endsAtMs === null ? null : endsAtMs - RATING_OPEN_BEFORE_MS;
  }
  private pending: RatingState | null = null;
  private pendingOpensAt: number | null = null;

  /** The song's length became known (Y-11): the window can open on time. */
  updateEnd(turnKey: string, endsAtMs: number) {
    if (this.pending?.turnKey !== turnKey) return;
    this.pending = { ...this.pending, closesAtMs: endsAtMs + RATING_CLOSE_AFTER_MS };
    this.pendingOpensAt = endsAtMs - RATING_OPEN_BEFORE_MS;
  }

  /**
   * The song ended (time, skip, singer left): if its window is not open yet, open it now for 10 s
   * (G-03 "or on skip"). Returns true when the rating state changed.
   */
  endTurn(): boolean {
    if (!this.pending) return false;
    const now = this.now();
    const st: RatingState = { ...this.pending, closesAtMs: Math.min(this.pending.closesAtMs, now + RATING_CLOSE_AFTER_MS) };
    if (this.rating?.state.turnKey === st.turnKey) this.rating.state = { ...this.rating.state, closesAtMs: st.closesAtMs };
    else this.rating = { state: st, votes: new Map(), peakHype: this.peakHype, opensAtMs: now };
    this.pending = null;
    return true;
  }

  ratingState(): RatingState | null {
    return this.rating ? { ...this.rating.state, count: this.rating.votes.size } : null;
  }

  rate(userId: string, turnKey: string, stars: number): { ok: true } | { ok: false; error: string } {
    const r = this.rating;
    if (!r || r.state.turnKey !== turnKey) return { ok: false, error: 'Đã hết giờ chấm điểm bài này' };
    if (r.state.singerIds.includes(userId)) return { ok: false, error: 'Ca sĩ không tự chấm điểm mình được' };
    r.votes.set(userId, stars);
    return { ok: true };
  }

  /**
   * Opens a window 30 s before the end, and closes a window whose time is up into a score.
   * Returns what changed for the caller to broadcast.
   */
  tickRating(): { rating: boolean; score?: ScoreResult } {
    const now = this.now();
    let rating = false;
    if (this.pending && this.pendingOpensAt !== null && now >= this.pendingOpensAt && this.rating?.state.turnKey !== this.pending.turnKey) {
      // A previous window still open (rare: very short song) is closed first.
      const prev = this.rating ? this.closeRating() : undefined;
      this.rating = { state: { ...this.pending }, votes: new Map(), peakHype: this.peakHype, opensAtMs: now };
      return { rating: true, score: prev };
    }
    if (this.rating) this.rating.peakHype = Math.max(this.rating.peakHype, this.hype);
    if (this.rating && now >= this.rating.state.closesAtMs) {
      const score = this.closeRating();
      rating = true;
      return { rating, score };
    }
    return { rating };
  }

  private closeRating(): ScoreResult {
    const r = this.rating!;
    this.rating = null;
    const { score, bonus } = computeScore([...r.votes.values()], r.peakHype);
    const result: ScoreResult = {
      turnKey: r.state.turnKey,
      title: r.state.title,
      singerNames: r.state.singerNames,
      score,
      ratings: r.votes.size,
      bonus,
      comment: scoreComment(score),
    };
    if (score !== null) {
      for (const name of r.state.singerNames) {
        const row = this.best.get(name) ?? { name, best: 0, songs: 0 };
        this.best.set(name, { name, best: Math.max(row.best, score), songs: row.songs + 1 });
      }
    }
    return result;
  }

  /** G-05: best score per singer tonight, highest first ("Ca sĩ của đêm" is the first row). */
  leaderboard(): LeaderboardRow[] {
    return [...this.best.values()].sort((a, b) => b.best - a.best || a.name.localeCompare(b.name));
  }
}
