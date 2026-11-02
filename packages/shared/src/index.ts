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
} as const;

export const RoomJoinInput = z.object({ code: RoomCode });
export type RoomJoinInput = z.infer<typeof RoomJoinInput>;

export type JoinAck = { ok: true; room: RoomInfo } | { ok: false; error: string };

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
