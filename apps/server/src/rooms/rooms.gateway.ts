import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import {
  ClockPingInput,
  Events,
  parseYouTubeId,
  PlaySetInput,
  RoomJoinInput,
  RT_NAMESPACE,
  RtcSignalInput,
  TEST_TRACK_LINK,
  TEST_TRACK_SECONDS,
  type Ack,
  type ClockPong,
  type JoinAck,
  type RtcSignalFromServer,
} from '@ktv/shared';
import { AuthService, type TokenUser } from '../auth/auth.service.js';
import { AUTH_COOKIE, readCookie } from '../auth/auth.cookie.js';
import { YouTubeService } from '../youtube/youtube.service.js';
import { RoomsService } from './rooms.service.js';
import { RoomState } from './room-state.js';

interface SocketData {
  user: TokenUser;
  roomCode?: string;
}
type KtvSocket = Socket & { data: Partial<SocketData> };

const channel = (code: string) => `room:${code}`;
/** An empty room keeps its song and state this long, so a refresh does not reset the night (R-10). */
const EMPTY_ROOM_TTL_MS = 30 * 60_000;

@WebSocketGateway({ namespace: RT_NAMESPACE })
export class RoomsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private ns!: Namespace;
  private readonly log = new Logger(RoomsGateway.name);
  private readonly live = new Map<string, RoomState>();
  private readonly cleanup = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly auth: AuthService,
    private readonly rooms: RoomsService,
    private readonly youtube: YouTubeService,
  ) {}

  /** Only logged-in users may connect: the same cookie as the website is checked here. */
  async handleConnection(client: KtvSocket) {
    const user = await this.auth.verifyToken(readCookie(client.handshake.headers.cookie, AUTH_COOKIE));
    if (!user) {
      client.emit('auth:error', 'Bạn cần đăng nhập');
      client.disconnect(true);
      return;
    }
    client.data.user = user;
  }

  handleDisconnect(client: KtvSocket) {
    this.leaveCurrentRoom(client);
  }

  /* ---------- joining ---------- */

  @SubscribeMessage(Events.roomJoin)
  async join(@ConnectedSocket() client: KtvSocket, @MessageBody() body: unknown): Promise<JoinAck> {
    const parsed = RoomJoinInput.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'Mã phòng không hợp lệ' };
    const user = client.data.user;
    if (!user) return { ok: false, error: 'Bạn cần đăng nhập' };

    const room = await this.rooms.findByCode(parsed.data.code);
    if (!room) return { ok: false, error: 'Không tìm thấy phòng' };
    const state = this.stateFor(room.code);
    if (!state.has(user.id) && state.size >= room.capacity) return { ok: false, error: 'Phòng đã đầy' };

    if (client.data.roomCode !== room.code) this.leaveCurrentRoom(client);
    client.data.roomCode = room.code;
    await client.join(channel(room.code));
    state.addSocket(user.id, user.displayName, client.id);
    this.emitPresence(state);
    this.log.log(`${user.displayName} joined ${room.code}`);
    return { ok: true, room, playback: state.playback, stage: state.stage };
  }

  /** Clock sync (Y-03): the client measures round-trip time and offset. */
  @SubscribeMessage(Events.clockPing)
  clock(@MessageBody() body: unknown): ClockPong | { error: string } {
    const parsed = ClockPingInput.safeParse(body);
    if (!parsed.success) return { error: 'bad ping' };
    return { t0: parsed.data.t0, server: Date.now() };
  }

  /* ---------- playback: anyone in the room may change it (no host in version 1) ---------- */

  @SubscribeMessage(Events.playSet)
  async playSet(@ConnectedSocket() client: KtvSocket, @MessageBody() body: unknown): Promise<Ack> {
    const ctx = this.context(client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    const parsed = PlaySetInput.safeParse(body);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Link không hợp lệ' };

    if (parsed.data.link === TEST_TRACK_LINK) {
      ctx.state.setSong({ kind: 'test', id: 'click', title: 'Nhạc thử nhịp (120 BPM)', durationSec: TEST_TRACK_SECONDS }, ctx.user.displayName);
    } else {
      const id = parseYouTubeId(parsed.data.link);
      if (!id) return { ok: false, error: 'Link YouTube không hợp lệ' };
      const check = await this.youtube.check(id);
      if (!check.ok) return check;
      ctx.state.setSong(check.song, ctx.user.displayName);
    }
    this.emitPlayback(ctx.state);
    return { ok: true };
  }

  @SubscribeMessage(Events.playPause)
  pause(@ConnectedSocket() client: KtvSocket): Ack {
    const ctx = this.context(client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    if (ctx.state.pause(ctx.user.displayName)) this.emitPlayback(ctx.state);
    return { ok: true };
  }

  @SubscribeMessage(Events.playResume)
  resume(@ConnectedSocket() client: KtvSocket): Ack {
    const ctx = this.context(client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    if (ctx.state.resume(ctx.user.displayName)) this.emitPlayback(ctx.state);
    return { ok: true };
  }

  /* ---------- stage ---------- */

  @SubscribeMessage(Events.stageTake)
  takeStage(@ConnectedSocket() client: KtvSocket): Ack {
    const ctx = this.context(client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    const r = ctx.state.takeStage(ctx.user.id);
    if (r.ok) this.emitStage(ctx.state);
    return r;
  }

  @SubscribeMessage(Events.stageLeave)
  leaveStage(@ConnectedSocket() client: KtvSocket): Ack {
    const ctx = this.context(client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    if (ctx.state.leaveStage(ctx.user.id)) this.emitStage(ctx.state);
    return { ok: true };
  }

  /* ---------- WebRTC connection setup: pass messages between two people in the same room ---------- */

  @SubscribeMessage(Events.rtcSignal)
  signal(@ConnectedSocket() client: KtvSocket, @MessageBody() body: unknown): Ack {
    const ctx = this.context(client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    const parsed = RtcSignalInput.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'bad signal' };
    // Send to the person's most recent tab only, so two tabs never both answer.
    const target = ctx.state.socketsOf(parsed.data.to).at(-1);
    if (!target) return { ok: false, error: 'Người này đã rời phòng' };
    const msg: RtcSignalFromServer = { from: ctx.user.id, data: parsed.data.data };
    this.ns.to(target).emit(Events.rtcSignal, msg);
    return { ok: true };
  }

  /* ---------- helpers ---------- */

  private context(client: KtvSocket) {
    const { user, roomCode } = client.data;
    const state = roomCode ? this.live.get(roomCode) : undefined;
    return user && state?.has(user.id) ? { user, state } : null;
  }

  private stateFor(code: string): RoomState {
    clearTimeout(this.cleanup.get(code));
    this.cleanup.delete(code);
    let s = this.live.get(code);
    if (!s) {
      s = new RoomState(code);
      this.live.set(code, s);
    }
    return s;
  }

  private leaveCurrentRoom(client: KtvSocket) {
    const { roomCode: code, user } = client.data;
    if (!code || !user) return;
    void client.leave(channel(code));
    client.data.roomCode = undefined;
    const state = this.live.get(code);
    if (!state) return;
    const wasSinger = state.stage.singerId === user.id;
    if (state.removeSocket(user.id, client.id)) {
      this.emitPresence(state);
      if (wasSinger) this.emitStage(state);
    }
    if (state.isEmpty) {
      this.cleanup.set(
        code,
        setTimeout(() => {
          if (this.live.get(code)?.isEmpty) this.live.delete(code);
          this.cleanup.delete(code);
        }, EMPTY_ROOM_TTL_MS).unref(),
      );
    }
  }

  private emitPresence(s: RoomState) {
    this.ns.to(channel(s.code)).emit(Events.roomPresence, s.presence());
  }
  private emitPlayback(s: RoomState) {
    this.ns.to(channel(s.code)).emit(Events.playState, s.playback);
  }
  private emitStage(s: RoomState) {
    this.ns.to(channel(s.code)).emit(Events.stageState, s.stage);
  }
}
