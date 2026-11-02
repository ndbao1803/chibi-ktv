import type { PresenceList } from '@ktv/shared';

/**
 * Who is in which room right now (in memory). A person with two tabs open counts once.
 * Lives only as long as the server process; that is fine for presence.
 */
export class Presence {
  private rooms = new Map<string, Map<string, { displayName: string; sockets: Set<string> }>>();

  add(code: string, userId: string, displayName: string, socketId: string) {
    const room = this.rooms.get(code) ?? new Map();
    this.rooms.set(code, room);
    const member = room.get(userId) ?? { displayName, sockets: new Set<string>() };
    member.sockets.add(socketId);
    room.set(userId, member);
  }

  /** Removes one socket; returns true if the person left the room completely. */
  remove(code: string, userId: string, socketId: string): boolean {
    const room = this.rooms.get(code);
    const member = room?.get(userId);
    if (!room || !member) return false;
    member.sockets.delete(socketId);
    if (member.sockets.size > 0) return false;
    room.delete(userId);
    if (room.size === 0) this.rooms.delete(code);
    return true;
  }

  has(code: string, userId: string) {
    return this.rooms.get(code)?.has(userId) ?? false;
  }

  count(code: string) {
    return this.rooms.get(code)?.size ?? 0;
  }

  list(code: string): PresenceList {
    return [...(this.rooms.get(code)?.entries() ?? [])].map(([userId, m]) => ({ userId, displayName: m.displayName }));
  }
}
