import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace } from 'socket.io';
import {
  ClockPingInput,
  Events,
  parseYouTubeId,
  PlayDurationInput,
  PlayErrorInput,
  PlaySetInput,
  QueueAddInput,
  QueueRemoveInput,
  RoomJoinInput,
  RT_NAMESPACE,
  RtcSignalInput,
  SeatTakeInput,
  SkipVoteInput,
  TEST_TRACK_LINK,
  TEST_TRACK_SECONDS,
  type Ack,
  type ClockPong,
  type JoinAck,
  type RtcSignalFromServer,
} from '@ktv/shared';
import { AuthService } from '../auth/auth.service.js';
import { AUTH_COOKIE, readCookie } from '../auth/auth.cookie.js';
import { YouTubeService } from '../youtube/youtube.service.js';
import { RoomsService } from './rooms.service.js';
import { RoomLiveService, channel } from './room-live.service.js';
import { leaveCurrentRoom, roomContext, type KtvSocket } from './socket-session.js';

@WebSocketGateway({ namespace: RT_NAMESPACE })
export class RoomsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer() private ns!: Namespace;
  private readonly log = new Logger(RoomsGateway.name);

  constructor(
    private readonly auth: AuthService,
    private readonly rooms: RoomsService,
    private readonly youtube: YouTubeService,
    private readonly live: RoomLiveService,
  ) {}

  afterInit(ns: Namespace) {
    this.live.attach(ns);
  }

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
    leaveCurrentRoom(this.live, client);
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
    const state = this.live.stateFor(room.code);
    if (!state.has(user.id) && state.size >= room.capacity) return { ok: false, error: 'Phòng đã đầy' };

    if (client.data.roomCode !== room.code) leaveCurrentRoom(this.live, client);
    client.data.roomCode = room.code;
    await client.join(channel(room.code));
    state.capacity = room.capacity;
    const back = state.addSocket(user.id, user.displayName, client.id);
    // A newcomer changes how many votes a skip needs; a returning singer may get the stage back.
    this.live.apply(state, { ...back, presence: true, skip: state.refreshSkip() });
    this.log.log(`${user.displayName} joined ${room.code}`);
    return { ok: true, room, playback: state.playback, stage: state.stage, queue: state.queue.state(), skip: state.skipState() };
  }

  /** Clock sync (Y-03): the client measures round-trip time and offset. */
  @SubscribeMessage(Events.clockPing)
  clock(@MessageBody() body: unknown): ClockPong | { error: string } {
    const parsed = ClockPingInput.safeParse(body);
    if (!parsed.success) return { error: 'bad ping' };
    return { t0: parsed.data.t0, server: Date.now() };
  }

  /* ---------- playback: the click track only; YouTube songs go through the queue (Y-12) ---------- */

  @SubscribeMessage(Events.playSet)
  playSet(@ConnectedSocket() client: KtvSocket, @MessageBody() body: unknown): Ack {
    const ctx = roomContext(this.live, client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    const parsed = PlaySetInput.safeParse(body);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Link không hợp lệ' };
    if (parsed.data.link !== TEST_TRACK_LINK) return { ok: false, error: 'Hãy dùng "Thêm vào danh sách" để hát YouTube' };

    ctx.state.setSong({ kind: 'test', id: 'click', title: 'Nhạc thử nhịp (120 BPM)', durationSec: TEST_TRACK_SECONDS }, ctx.user.displayName);
    this.live.emitPlayback(ctx.state);
    return { ok: true };
  }

  @SubscribeMessage(Events.playPause)
  pause(@ConnectedSocket() client: KtvSocket): Ack {
    const ctx = roomContext(this.live, client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    if (ctx.state.pause(ctx.user.displayName)) this.live.emitPlayback(ctx.state);
    return { ok: true };
  }

  @SubscribeMessage(Events.playResume)
  resume(@ConnectedSocket() client: KtvSocket): Ack {
    const ctx = roomContext(this.live, client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    if (ctx.state.resume(ctx.user.displayName)) this.live.emitPlayback(ctx.state);
    return { ok: true };
  }

  /** A browser tells us the video's length once its player knows it (Y-11). */
  @SubscribeMessage(Events.playDuration)
  playDuration(@ConnectedSocket() client: KtvSocket, @MessageBody() body: unknown): Ack {
    const ctx = roomContext(this.live, client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    const parsed = PlayDurationInput.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'Thời lượng không hợp lệ' };
    this.live.apply(ctx.state, ctx.state.reportDuration(parsed.data.rev, parsed.data.durationSec));
    return { ok: true };
  }

  /** A browser's player hit an error; fatal ones skip the song for everyone (Y-08). */
  @SubscribeMessage(Events.playError)
  playError(@ConnectedSocket() client: KtvSocket, @MessageBody() body: unknown): Ack {
    const ctx = roomContext(this.live, client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    const parsed = PlayErrorInput.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'Mã lỗi không hợp lệ' };
    this.live.apply(ctx.state, ctx.state.reportError(parsed.data.rev, parsed.data.code));
    return { ok: true };
  }

  /* ---------- queue: anyone may add; only the owner may remove their own entry (Q-01, Q-05, Q-06) ---------- */

  @SubscribeMessage(Events.queueAdd)
  async queueAdd(@ConnectedSocket() client: KtvSocket, @MessageBody() body: unknown): Promise<Ack & { entryId?: string }> {
    const ctx = roomContext(this.live, client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    const parsed = QueueAddInput.safeParse(body);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Link không hợp lệ' };
    const id = parseYouTubeId(parsed.data.link);
    if (!id) return { ok: false, error: 'Link YouTube không hợp lệ' };
    const check = await this.youtube.check(id);
    if (!check.ok) return check;

    const added = ctx.state.queue.add(check.song, ctx.user.id, ctx.user.displayName, Date.now());
    if (!added.ok) return added;
    // A free queue starts singing right away (S-01); either way, `queue:state` always goes out.
    this.live.apply(ctx.state, { ...ctx.state.startTurnIfIdle(), queue: true });
    this.log.log(`${ctx.user.displayName} added a song in ${ctx.state.code}`);
    return { ok: true, entryId: added.entryId };
  }

  @SubscribeMessage(Events.queueRemove)
  queueRemove(@ConnectedSocket() client: KtvSocket, @MessageBody() body: unknown): Ack {
    const ctx = roomContext(this.live, client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    const parsed = QueueRemoveInput.safeParse(body);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Mã bài hát không hợp lệ' };
    const removed = ctx.state.queue.removeOwn(parsed.data.entryId, ctx.user.id);
    if (removed.ok) this.live.emitQueue(ctx.state);
    return removed;
  }

  /* ---------- vote-skip: half of the non-singers skip the song playing now (Q-07) ---------- */

  @SubscribeMessage(Events.skipVote)
  skipVote(@ConnectedSocket() client: KtvSocket, @MessageBody() body: unknown): Ack {
    const ctx = roomContext(this.live, client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    const parsed = SkipVoteInput.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'Phiếu bầu không hợp lệ' };
    const r = ctx.state.vote(ctx.user.id, parsed.data.vote);
    if (!r.ok) return r;
    this.live.apply(ctx.state, r.effects);
    return { ok: true };
  }

  /* ---------- stage: a turn puts its singer here (S-01); `stage:take` still works for an empty stage ---------- */

  @SubscribeMessage(Events.stageTake)
  takeStage(@ConnectedSocket() client: KtvSocket): Ack {
    const ctx = roomContext(this.live, client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    const r = ctx.state.takeStage(ctx.user.id);
    if (!r.ok) return r;
    this.live.apply(ctx.state, r.effects);
    return { ok: true };
  }

  /** "Giữ bài" (R-09): the song keeps playing although its singer dropped. */
  @SubscribeMessage(Events.turnKeep)
  keepSong(@ConnectedSocket() client: KtvSocket): Ack {
    const ctx = roomContext(this.live, client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    const r = ctx.state.keepSong(ctx.user.id);
    if (!r.ok) return r;
    this.live.apply(ctx.state, r.effects);
    return { ok: true };
  }

  /** R-11..R-13: sit somewhere else; the first click on a free seat wins. */
  @SubscribeMessage(Events.seatTake)
  takeSeat(@ConnectedSocket() client: KtvSocket, @MessageBody() body: unknown): Ack {
    const ctx = roomContext(this.live, client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    const parsed = SeatTakeInput.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'Ghế không hợp lệ' };
    const r = ctx.state.takeSeat(ctx.user.id, parsed.data.seat);
    if (!r.ok) return r;
    this.live.apply(ctx.state, r.effects);
    return { ok: true };
  }

  @SubscribeMessage(Events.stageLeave)
  leaveStage(@ConnectedSocket() client: KtvSocket): Ack {
    const ctx = roomContext(this.live, client);
    if (!ctx) return { ok: false, error: 'Bạn chưa ở trong phòng' };
    this.live.apply(ctx.state, ctx.state.leaveStage(ctx.user.id));
    return { ok: true };
  }

  /* ---------- WebRTC connection setup: pass messages between two people in the same room ---------- */

  @SubscribeMessage(Events.rtcSignal)
  signal(@ConnectedSocket() client: KtvSocket, @MessageBody() body: unknown): Ack {
    const ctx = roomContext(this.live, client);
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
}
