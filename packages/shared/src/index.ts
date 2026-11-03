import { z } from 'zod';

/* ---------- Accounts ---------- */

export const RegisterInput = z.object({
  email: z.email().max(254).transform((e) => e.trim().toLowerCase()),
  password: z.string().min(8, 'Mật khẩu cần ít nhất 8 ký tự').max(128),
  displayName: z.string().trim().min(1, 'Hãy nhập tên hiển thị').max(24),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: z.email().transform((e) => e.trim().toLowerCase()),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginInput>;

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
}

/* ---------- Rooms ---------- */

export const ROOM_CODE_LENGTH = 6;
export const RoomCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6}$/, 'Mã phòng gồm 6 chữ hoặc số');

export const CreateRoomInput = z.object({
  name: z.string().trim().min(1).max(40).default('Phòng karaoke'),
  capacity: z.union([z.literal(8), z.literal(16)]).default(8),
});
export type CreateRoomInput = z.infer<typeof CreateRoomInput>;

export interface RoomInfo {
  code: string;
  name: string;
  capacity: number;
  ownerName: string;
}

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
} as const;

export type Ack = { ok: true } | { ok: false; error: string };

export const RoomJoinInput = z.object({ code: RoomCode });
export type RoomJoinInput = z.infer<typeof RoomJoinInput>;

export type JoinAck =
  | { ok: true; room: RoomInfo; playback: PlaybackState; stage: StageState }
  | { ok: false; error: string };

export interface PresenceMember {
  userId: string;
  displayName: string;
}
export type PresenceList = PresenceMember[];

export const ClockPingInput = z.object({ t0: z.number() });
export interface ClockPong {
  t0: number;
  server: number;
}

/* ---------- Songs ---------- */

/** A built-in click track (120 BPM) for testing sync without YouTube. */
export const TEST_TRACK_LINK = 'test:click';
export const TEST_TRACK_BPM = 120;
export const TEST_TRACK_SECONDS = 600;

export type SongRef =
  | { kind: 'youtube'; id: string; title: string; durationSec: number | null }
  | { kind: 'test'; id: 'click'; title: string; durationSec: number };

export const PlaySetInput = z.object({ link: z.string().trim().min(1, 'Hãy dán link YouTube').max(300) });

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Accepts youtu.be/ID, youtube.com/watch?v=ID, /shorts/ID, /embed/ID, /live/ID, music.youtube.com, or a bare 11-character ID. */
export function parseYouTubeId(input: string): string | null {
  const text = input.trim();
  if (YT_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v');
    const m = url.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
    if (!id && m) id = m[2];
  }
  return id && YT_ID.test(id) ? id : null;
}

/* ---------- Playback (server is the source of truth, Y-02) ---------- */

export interface PlaybackState {
  song: SongRef | null;
  /** Server time (ms) at which the song was at position 0. */
  startedAtServerMs: number;
  paused: boolean;
  /** Position (s) where it was paused. */
  pausedAtSec: number;
  /** Who made the last change, shown as a toast (no host in version 1). */
  updatedBy: string | null;
  /** Increases on every change, so clients can ignore stale updates. */
  rev: number;
}

export const EMPTY_PLAYBACK: PlaybackState = {
  song: null,
  startedAtServerMs: 0,
  paused: true,
  pausedAtSec: 0,
  updatedBy: null,
  rev: 0,
};

/** Where the song should be (s) at a given server time, never below 0. */
export function expectedPosition(p: PlaybackState, serverNowMs: number): number {
  if (!p.song) return 0;
  if (p.paused) return p.pausedAtSec;
  return Math.max(0, (serverNowMs - p.startedAtServerMs) / 1000);
}

/** Lead time before a new song starts, so every browser has time to load it. */
export const START_LEAD_MS = 2500;

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
}

export interface IceServersResponse {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
}
