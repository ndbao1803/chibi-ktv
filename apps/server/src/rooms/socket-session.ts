import type { Socket } from 'socket.io';
import type { TokenUser } from '../auth/auth.service.js';
import { RoomLiveService, channel } from './room-live.service.js';

export interface SocketData {
  user: TokenUser;
  roomCode?: string;
}
export type KtvSocket = Socket & { data: Partial<SocketData> };

/** The room + verified user behind one socket, or `null` when it never joined (or joined elsewhere). */
export function roomContext(live: RoomLiveService, client: KtvSocket) {
  const { user, roomCode } = client.data;
  const state = roomCode ? live.get(roomCode) : undefined;
  return user && state?.has(user.id) ? { user, state } : null;
}

/** Leaves the socket.io room and, once every tab of that member is closed, updates the live state. */
export function leaveCurrentRoom(live: RoomLiveService, client: KtvSocket) {
  const { roomCode: code, user } = client.data;
  if (!code || !user) return;
  void client.leave(channel(code));
  client.data.roomCode = undefined;
  const state = live.get(code);
  if (!state) return;
  // Their last tab closing only marks them away for 20 s (N-12); the room tick removes them later.
  const effects = state.removeSocket(user.id, client.id);
  if (effects) live.apply(state, effects);
}
