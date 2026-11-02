import { Injectable, OnDestroy, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import { Events, RT_NAMESPACE, type ClockPong, type JoinAck, type PresenceList, type RoomInfo } from '@ktv/shared';

export interface ClockStats {
  offsetMs: number; // server time = local time + offset
  rttMs: number; // best round trip
}

/**
 * One Socket.IO connection per room page. The login cookie is sent automatically
 * with the handshake, so the server knows who we are.
 */
@Injectable()
export class RealtimeService implements OnDestroy {
  private socket?: Socket;
  private clockTimer?: ReturnType<typeof setInterval>;

  readonly connected = signal(false);
  readonly room = signal<RoomInfo | null>(null);
  readonly members = signal<PresenceList>([]);
  readonly error = signal('');
  readonly clock = signal<ClockStats | null>(null);

  async join(code: string): Promise<void> {
    this.socket = io(RT_NAMESPACE, { transports: ['websocket', 'polling'], withCredentials: true });
    this.socket.on(Events.roomPresence, (list: PresenceList) => this.members.set(list));
    this.socket.on('auth:error', (msg: string) => this.error.set(msg));
    this.socket.on('disconnect', () => this.connected.set(false));
    // On every (re)connect: join the room again and re-measure the clock.
    this.socket.on('connect', async () => {
      this.connected.set(true);
      const ack = (await this.socket!.emitWithAck(Events.roomJoin, { code })) as JoinAck;
      if (!ack.ok) {
        this.error.set(ack.error);
        return;
      }
      this.error.set('');
      this.room.set(ack.room);
      await this.syncClock();
    });
    this.clockTimer = setInterval(() => void this.syncClock(), 30_000);
  }

  /**
   * NTP-style clock sync (requirement Y-03): ask the server for its time 5 times and
   * keep the sample with the shortest round trip; it has the least network noise.
   * This offset is what later keeps everyone's YouTube video in step.
   */
  async syncClock(samples = 5): Promise<void> {
    if (!this.socket?.connected) return;
    let best: ClockStats | null = null;
    for (let i = 0; i < samples; i++) {
      const t0 = Date.now();
      const pong = (await this.socket.emitWithAck(Events.clockPing, { t0 })) as ClockPong;
      const t1 = Date.now();
      const rtt = t1 - t0;
      const offset = pong.server - (t0 + t1) / 2;
      if (!best || rtt < best.rttMs) best = { offsetMs: Math.round(offset), rttMs: rtt };
    }
    this.clock.set(best);
  }

  ngOnDestroy(): void {
    clearInterval(this.clockTimer);
    this.socket?.disconnect();
  }
}
