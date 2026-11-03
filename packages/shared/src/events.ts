import { z } from 'zod';
import type { RoomInfo, PlaybackState } from './index.js';
import type { QueueState } from './queue.js';
import type { SkipState } from './skip.js';

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
  /** client → server {rev, durationSec}, ack: Ack. Reports a YouTube video's duration once known (Y-11). */
  playDuration: 'play:duration',
  /** client → server {rev, code}, ack: Ack. Reports a YouTube player error so the server can skip it. */
  playError: 'play:error',
} as const;

export type Ack = { ok: true } | { ok: false; error: string };

export type JoinAck =
  | { ok: true; room: RoomInfo; playback: PlaybackState; stage: StageState; queue: QueueState; skip: SkipState }
  | { ok: false; error: string };

export interface PresenceMember {
  userId: string;
  displayName: string;
  /** True while this member is mid-reconnect (N-12): their seat and queue entries are kept. */
  away: boolean;
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
}

export const RtcSignalInput = z.object({
  to: z.string().uuid(),
  data: z.union([
    z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(20_000) }),
    z.object({ type: z.literal('ice'), candidate: z.any() }),
  ]),
});
export type RtcSignalData = z.infer<typeof RtcSignalInput>['data'];
export interface RtcSignalFromServer {
  from: string;
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
