import { z } from 'zod';
import type { RoomInfo, PlaybackState } from './index.js';
import type { QueueState } from './queue.js';
import type { SkipState } from './skip.js';
import type { ChatMessage, LeaderboardRow, MicMode, PartyState, Prop, RatingState } from './party.js';

/* ---------- Realtime events (Socket.IO, namespace "/rt") ---------- */

export const RT_NAMESPACE = '/rt';

export const Events = {
  /** client → server, ack: JoinAck */
  roomJoin: 'room:join',
  /** server → room: PresenceList */
  roomPresence: 'room:presence',
  /** client → server, ack: ClockPong */
  clockPing: 'clock:ping',
  /** client → server {link}, ack: Ack. Anyone may change the song in version 1 (no host). */
  playSet: 'play:set',
  /** client → server, ack: Ack */
  playPause: 'play:pause',
  /** client → server, ack: Ack */
  playResume: 'play:resume',
  /** server → room: PlaybackState */
  playState: 'play:state',
  /** client → server, ack: Ack. Go on stage (one singer in Phase 1). */
  stageTake: 'stage:take',
  /** client → server, ack: Ack */
  stageLeave: 'stage:leave',
  /** server → room: StageState */
  stageState: 'stage:state',
  /** client → server {to, data}; server → the target {from, data}. WebRTC connection setup. */
  rtcSignal: 'rtc:signal',
  /** client → server {link}, ack: Ack & {entryId}. Checked against videos.list before accepting (Y-12). */
  queueAdd: 'queue:add',
  /** client → server {entryId}, ack: Ack. Members may remove only their own entries (Q-06). */
  queueRemove: 'queue:remove',
  /** server → room: QueueState */
  queueState: 'queue:state',
  /** client → server {vote}, ack: Ack. Vote to skip the current song (Q-07). */
  skipVote: 'skip:vote',
  /** server → room: SkipState */
  skipState: 'skip:state',
  /** client → server, ack: Ack. "Giữ bài": the song keeps playing past the singer's away grace. */
  turnKeep: 'turn:keep',
  /** client → server: { seat } — sit somewhere else (R-11) */
  seatTake: 'seat:take',
  /** client → server {mode}, ack: Ack. Push-to-talk or open mic (VC-01, VC-10). */
  micMode: 'mic:mode',
  /** client → server {kind}, ack: Ack; server → room FxEvent. Cheers now, the party layer later. */
  fxSend: 'fx:send',
  fx: 'fx',
  /** server → the invited person: DuetInvite (S-08). */
  duetInvite: 'duet:invite',
  /** client → server {entryId, yes}, ack: Ack (S-09). */
  duetAnswer: 'duet:answer',
  /** client → server {entryId}, ack: Ack. The inviter takes the invite back (S-10). */
  duetCancel: 'duet:cancel',
  /** client → server {open}, ack: Ack. "Không nhận lời mời" (S-11). */
  invitesSet: 'invites:set',
  /** client → server {prop} (M-04); {on} shake start/stop (M-01..M-03). */
  propSet: 'prop:set',
  shakeSet: 'shake:set',
  /** server → room: PartyState (hype meter, crowd dance, who shakes). */
  partyState: 'party:state',
  /** client → server {text}, ack: Ack; server → room: ChatMessage (CH-01..CH-04). */
  chatSend: 'chat:send',
  chatMsg: 'chat:msg',
  /** server → room: RatingState | null — the rating window (G-03). */
  ratingState: 'rating:state',
  /** client → server {turnKey, stars}, ack: Ack. */
  rateSend: 'rate:send',
  /** server → room: ScoreResult, then LeaderboardRow[] (G-01, G-05). */
  score: 'score',
  leaderboard: 'leaderboard',
  /** client → server {rev, durationSec}, ack: Ack. Reports a YouTube video's duration once known (Y-11). */
  playDuration: 'play:duration',
  /** client → server {rev, code}, ack: Ack. Reports a YouTube player error so the server can skip it. */
  playError: 'play:error',
} as const;

export type Ack = { ok: true } | { ok: false; error: string };

export type JoinAck =
  | {
      ok: true;
      room: RoomInfo;
      playback: PlaybackState;
      stage: StageState;
      queue: QueueState;
      skip: SkipState;
      party: PartyState;
      /** The last 50 messages (CH-03). */
      chat: ChatMessage[];
      rating: RatingState | null;
      leaderboard: LeaderboardRow[];
    }
  | { ok: false; error: string };

export interface PresenceMember {
  userId: string;
  displayName: string;
  /** True while this member is mid-reconnect (N-12): their seat and queue entries are kept. */
  away: boolean;
  /** Where they sit (0–15, see seats.ts); kept while on stage or away (R-13). */
  seat: number | null;
  /** How they talk to the room (VC-01). */
  mic: MicMode;
  /** False when they turned duet invites off (S-11). */
  invites: boolean;
  /** Prop in their hands (M-04). */
  prop: Prop;
}
export type PresenceList = PresenceMember[];

export const ClockPingInput = z.object({ t0: z.number() });
export interface ClockPong {
  t0: number;
  server: number;
}

/* ---------- Stage + voice ---------- */

export interface StageState {
  singerId: string | null;
  singerName: string | null;
  /** The second singer of a duet (S-12). Their voice goes over the talk connections at full level. */
  partnerId: string | null;
  partnerName: string | null;
}
export const EMPTY_STAGE: StageState = { singerId: null, singerName: null, partnerId: null, partnerName: null };

export const RtcSignalInput = z.object({
  to: z.string().uuid(),
  /** sing = the singer's voice + music positions; talk = everyone's voice (Phase 4). */
  ch: z.enum(['sing', 'talk']).default('sing'),
  data: z.union([
    z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(20_000) }),
    z.object({ type: z.literal('ice'), candidate: z.any() }),
  ]),
});
export type RtcSignalData = z.infer<typeof RtcSignalInput>['data'];
export interface RtcSignalFromServer {
  from: string;
  ch: 'sing' | 'talk';
  data: RtcSignalData;
}

/**
 * Sent by the singer to every listener over the WebRTC data channel, about 4 times a second (Y-05).
 * `atServerMs` is the singer's estimate of server time when `pos` was read.
 */
export interface SingerPosition {
  pos: number;
  atServerMs: number;
  playing: boolean;
  rev: number;
  /**
   * How late the singer hears their own music plus their mic delay (s): sound card output,
   * Bluetooth headphones, mic input. The singer sings to what they hear, so listeners add this too.
   */
  lagSec?: number;
}

export type HeadphoneKind = 'wired' | 'bluetooth' | 'none';

export interface IceServersResponse {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
}
