import { z } from 'zod';

/* ---------- Everyone's voice (VC-01..VC-10) ---------- */

/** off = never talked yet; ptt = hold V / 🎙️ to talk (default); open = mic always on (VC-01). */
export type MicMode = 'off' | 'ptt' | 'open';
export const MicModeInput = z.object({ mode: z.enum(['off', 'ptt', 'open']) });
/** At most this many open mics at once, so a room of 16 stays light on phones (VC-10). */
export const MAX_OPEN_MICS = 8;
/** Audience voices during a song, as a share of normal (VC-02); each listener can change it (VC-03). */
export const AUDIENCE_LEVEL_DEFAULT = 0.3;
/** What singers hear of the audience while singing (VC-06). */
export const SINGER_HEARS_AUDIENCE = 0.15;

/* ---------- Room effects everyone sees and hears (VC-04, M-07, FM-01, FM-02, FM-05) ---------- */

export const REACTIONS = { heart: '❤️', fire: '🔥', clap: '👏', laugh: '😂' } as const;
export const FX_KINDS = ['cheer', 'heart', 'fire', 'clap', 'laugh', 'flower', 'cungly', 'fart'] as const;
export type FxKind = (typeof FX_KINDS)[number];
export const FxInput = z.object({ kind: z.enum(FX_KINDS) });
/** Server → room: who did what, and when by server time (the cụng ly countdown is timed from it). */
export interface FxEvent {
  userId: string;
  kind: FxKind;
  atMs: number;
}
/** Minimum time between two of the same effect from one person. Cụng ly is per room (FM-01). */
export const FX_COOLDOWN_MS: Record<FxKind, number> = {
  cheer: 3000, // VC-04
  heart: 300,
  fire: 300,
  clap: 300,
  laugh: 300,
  flower: 1000, // FM-02
  cungly: 60_000, // FM-01, whole room
  fart: 120_000, // FM-06
};
/** How much each effect fills the hype meter (0..1). */
export const FX_HYPE: Record<FxKind, number> = { cheer: 0.04, heart: 0.02, fire: 0.02, clap: 0.02, laugh: 0.02, flower: 0.03, cungly: 0.15, fart: 0.02 };
/** "1, 2, 3, DÔ!": the glasses clink this long after the cụng ly starts. */
export const CUNGLY_DO_MS = 3000;

/* ---------- Props, shaking and the hype meter (M-01..M-06, FM-03, FM-04) ---------- */

export const PROPS = ['maracas', 'lightstick', 'tambourine', 'clap'] as const;
export type Prop = (typeof PROPS)[number];
export const PropInput = z.object({ prop: z.enum(PROPS) });
export const ShakeInput = z.object({ on: z.boolean() });
/** Shake on/off messages per member per second (M-03). */
export const SHAKE_MAX_PER_SEC = 8;
/** The crowd dance when the meter fills (FM-03). */
export const DANCE_MS = 8000;

/** Server → room, whenever it changes (shake changes are batched to at most 8 a second). */
export interface PartyState {
  /** 0..1 */
  hype: number;
  /** Server time the crowd dance ends; null when nobody is dancing. */
  danceUntilMs: number | null;
  /** Who is shaking their prop right now. */
  shakers: string[];
  rev: number;
}
export const EMPTY_PARTY: PartyState = { hype: 0, danceUntilMs: null, shakers: [], rev: 0 };

/* ---------- Chat (CH-01..CH-11) ---------- */

export const CHAT_MAX = 200;
export const CHAT_HISTORY = 50;
/** 5 messages per 10 s per member (CH-11). */
export const CHAT_RATE = { count: 5, perMs: 10_000 };
export const ChatInput = z.object({ text: z.string().trim().min(1, 'Tin nhắn trống').max(CHAT_MAX, 'Tối đa 200 ký tự') });
export const QUICK_PHRASES = ['Hay quá!', 'Dô dô dô!', 'Hát lại đi!', 'Bài tiếp!'] as const;
export interface ChatMessage {
  id: number;
  /** system = room news (joins, next singer, skips, scores: CH-04); me = an action line. */
  kind: 'user' | 'system' | 'me';
  userId: string | null;
  name: string;
  text: string;
  atMs: number;
}

/* ---------- Rating and the score screen (G-01..G-06) ---------- */

/** The rating window opens this long before the song ends (or on skip) and closes after it. */
export const RATING_OPEN_BEFORE_MS = 30_000;
export const RATING_CLOSE_AFTER_MS = 10_000;
export const RateInput = z.object({ turnKey: z.string().max(80), stars: z.number().int().min(1).max(5) });
export interface RatingState {
  /** Which performance is being rated (the playback rev it started with). */
  turnKey: string;
  title: string;
  singerIds: string[];
  singerNames: string[];
  closesAtMs: number;
  /** How many have rated so far (not who, not what). */
  count: number;
}
export interface ScoreResult {
  turnKey: string;
  title: string;
  singerNames: string[];
  /** 0..100, or null when nobody rated ("Không có đánh giá"). */
  score: number | null;
  ratings: number;
  /** Peak hype bonus included in the score (0..10, G-02). */
  bonus: number;
  comment: string;
}
export interface LeaderboardRow {
  name: string;
  best: number;
  songs: number;
}

/** G-02: crowd score (average stars mapped to 0..100) plus up to +10 for hype, capped at 100. */
export function computeScore(stars: readonly number[], peakHype: number): { score: number | null; bonus: number } {
  const bonus = Math.round(Math.max(0, Math.min(1, peakHype)) * 10);
  if (!stars.length) return { score: null, bonus };
  const avg = stars.reduce((a, b) => a + b, 0) / stars.length;
  return { score: Math.min(100, Math.round(((avg - 1) / 4) * 90 + 10) + bonus), bonus };
}

/** KTV-style comment for a score (G-01). */
export function scoreComment(score: number | null): string {
  if (score === null) return 'Không có đánh giá';
  if (score >= 95) return 'Siêu sao! Cả phòng đứng dậy vỗ tay!';
  if (score >= 85) return 'Hát hay quá!';
  if (score >= 70) return 'Giọng ngọt ghê!';
  if (score >= 50) return 'Cũng được đó, hát tiếp nào!';
  return 'Lần sau sẽ hay hơn!';
}

/* ---------- Duets (S-07..S-13) ---------- */

export const DUET_INVITE_MS = 30_000;
export const DuetAnswerInput = z.object({ entryId: z.string().uuid(), yes: z.boolean() });
export const DuetCancelInput = z.object({ entryId: z.string().uuid() });
export const InvitesSetInput = z.object({ open: z.boolean() });

/** Server → the invited person only (S-08). */
export interface DuetInvite {
  entryId: string;
  title: string;
  fromName: string;
  /** 1-based place in the queue right now. */
  position: number;
  expiresAtMs: number;
}
