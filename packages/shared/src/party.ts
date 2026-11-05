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

/* ---------- Room effects everyone sees and hears (VC-04 and, in Phase 5, the party layer) ---------- */

export const FX_KINDS = ['cheer'] as const;
export type FxKind = (typeof FX_KINDS)[number];
export const FxInput = z.object({ kind: z.enum(FX_KINDS) });
/** Server → room: who did what. */
export interface FxEvent {
  userId: string;
  kind: FxKind;
}
/** Minimum time between two of the same effect from one person (VC-04: one cheer per 3 s). */
export const FX_COOLDOWN_MS: Record<FxKind, number> = { cheer: 3000 };

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
