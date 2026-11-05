import { Injectable, OnDestroy, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import {
  EMPTY_PLAYBACK,
  Events,
  RT_NAMESPACE,
  type Ack,
  type ClockPong,
  type JoinAck,
  type PlaybackState,
  type PresenceList,
  type QueueState,
  type RoomInfo,
  type RtcSignalData,
  type RtcSignalFromServer,
  type SkipState,
  type StageState,
} from '@ktv/shared';

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
  readonly playback = signal<PlaybackState>(EMPTY_PLAYBACK);
  readonly stage = signal<StageState>({ singerId: null, singerName: null });
  /** The song queue and whose turn it is (Q-03, Q-05). */
  readonly queue = signal<QueueState | null>(null);
  /** Vote-skip numbers for the song playing now (Q-07). */
  readonly skip = signal<SkipState | null>(null);
  readonly error = signal('');
  readonly clock = signal<ClockStats | null>(null);
  /** Short messages such as "Tuấn đã tạm dừng". */
  readonly notice = signal('');
  /** The voice service listens here for WebRTC setup messages. */
  onSignal: (m: RtcSignalFromServer) => void = () => {};

  /** Best estimate of the server's clock right now. */
  serverNow(): number {
    return Date.now() + (this.clock()?.offsetMs ?? 0);
  }

  async join(code: string): Promise<void> {
    this.socket = io(RT_NAMESPACE, { transports: ['websocket', 'polling'], withCredentials: true });
    this.socket.on(Events.roomPresence, (list: PresenceList) => this.members.set(list));
    this.socket.on(Events.playState, (p: PlaybackState) => this.applyPlayback(p));
    this.socket.on(Events.stageState, (s: StageState) => this.stage.set(s));
    // Drop out-of-order broadcasts: a higher rev is always newer.
    this.socket.on(Events.queueState, (q: QueueState) => {
      if (q.rev >= (this.queue()?.rev ?? -1)) this.queue.set(q);
    });
    this.socket.on(Events.skipState, (s: SkipState) => {
      if (s.rev >= (this.skip()?.rev ?? -1)) this.skip.set(s);
    });
    this.socket.on('room:notice', (msg: string) => this.notice.set(msg));
    this.socket.on(Events.rtcSignal, (m: RtcSignalFromServer) => this.onSignal(m));
    this.socket.on('auth:error', (msg: string) => this.error.set(msg));
    this.socket.on('disconnect', () => this.connected.set(false));
    // On every (re)connect: measure the clock, then join the room again (N-12).
    this.socket.on('connect', async () => {
      this.connected.set(true);
      await this.syncClock();
      const ack = (await this.socket!.emitWithAck(Events.roomJoin, { code })) as JoinAck;
      if (!ack.ok) {
        this.error.set(ack.error);
        return;
      }
      this.error.set('');
      this.room.set(ack.room);
      this.playback.set(ack.playback);
      this.stage.set(ack.stage);
      this.queue.set(ack.queue);
      this.skip.set(ack.skip);
    });
    this.clockTimer = setInterval(() => void this.syncClock(), 30_000);
  }

  /** The built-in click track only; YouTube songs go through the queue. */
  setSong(link: string): Promise<Ack> {
    return this.emit(Events.playSet, { link });
  }
  /** Adds a YouTube song with me as the singer. If nothing is playing, my turn starts right away. */
  addToQueue(link: string): Promise<Ack> {
    return this.emit(Events.queueAdd, { link });
  }
  /** Q-06: take one of my own songs out of the queue. */
  removeFromQueue(entryId: string): Promise<Ack> {
    return this.emit(Events.queueRemove, { entryId });
  }
  /** R-09: the singer dropped; let the song play to the end anyway. */
  keepSong(): Promise<Ack> {
    return this.emit(Events.turnKeep, {});
  }
  /** Y-11: tell the server how long the video is, so it can end the song on time. */
  reportDuration(rev: number, durationSec: number): void {
    this.socket?.emit(Events.playDuration, { rev, durationSec });
  }
  /** Y-08: this video cannot play here; the server skips it for everyone. */
  reportPlayerError(rev: number, code: number): void {
    this.socket?.emit(Events.playError, { rev, code });
  }
  voteSkip(vote: boolean): Promise<Ack> {
    return this.emit(Events.skipVote, { vote });
  }
  pause(): Promise<Ack> {
    return this.emit(Events.playPause);
  }
  resume(): Promise<Ack> {
    return this.emit(Events.playResume);
  }
  takeStage(): Promise<Ack> {
    return this.emit(Events.stageTake);
  }
  /** R-11: sit somewhere else; everyone sees the walk once the server agrees. */
  takeSeat(seat: number): Promise<Ack> {
    return this.emit(Events.seatTake, { seat });
  }
  leaveStage(): Promise<Ack> {
    return this.emit(Events.stageLeave);
  }
  signal(to: string, data: RtcSignalData): void {
    this.socket?.emit(Events.rtcSignal, { to, data });
  }

  /**
   * NTP-style clock sync (Y-03): ask the server for its time 5 times and keep the sample
   * with the shortest round trip; it has the least network noise.
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

  private applyPlayback(p: PlaybackState) {
    const prev = this.playback();
    if (p.rev < prev.rev) return; // stale
    this.playback.set(p);
    if (p.updatedBy) {
      const what =
        p.song?.id !== prev.song?.id ? `chọn bài “${p.song?.title}”` : p.paused ? 'tạm dừng' : 'phát tiếp';
      this.notice.set(`${p.updatedBy} đã ${what}`);
    }
  }

  private async emit(event: string, payload?: unknown): Promise<Ack> {
    if (!this.socket?.connected) return { ok: false, error: 'Mất kết nối, đang thử lại…' };
    return (await this.socket.emitWithAck(event, payload)) as Ack;
  }
}
