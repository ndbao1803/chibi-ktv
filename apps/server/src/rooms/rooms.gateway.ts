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
  RoomJoinInput,
  RT_NAMESPACE,
  type ClockPong,
  type JoinAck,
} from '@ktv/shared';
import { AuthService, type TokenUser } from '../auth/auth.service.js';
import { AUTH_COOKIE, readCookie } from '../auth/auth.cookie.js';
import { RoomsService } from './rooms.service.js';
import { Presence } from './presence.js';

interface SocketData {
  user: TokenUser;
  roomCode?: string;
}
type KtvSocket = Socket & { data: Partial<SocketData> };

const channel = (code: string) => `room:${code}`;

@WebSocketGateway({ namespace: RT_NAMESPACE })
export class RoomsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private ns!: Namespace;
  private readonly log = new Logger(RoomsGateway.name);
  readonly presence = new Presence();

  constructor(
    private readonly auth: AuthService,
    private readonly rooms: RoomsService,
  ) {}

  /** Only logged-in users may connect: the same cookie as the website is checked here. */
  async handleConnection(client: KtvSocket) {
    const token = readCookie(client.handshake.headers.cookie, AUTH_COOKIE);
    const user = await this.auth.verifyToken(token);
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

  @SubscribeMessage(Events.roomJoin)
  async join(@ConnectedSocket() client: KtvSocket, @MessageBody() body: unknown): Promise<JoinAck> {
    const parsed = RoomJoinInput.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'Mã phòng không hợp lệ' };
    const { user } = client.data;
    if (!user) return { ok: false, error: 'Bạn cần đăng nhập' };

    const room = await this.rooms.findByCode(parsed.data.code);
    if (!room) return { ok: false, error: 'Không tìm thấy phòng' };
    if (!this.presence.has(room.code, user.id) && this.presence.count(room.code) >= room.capacity) {
      return { ok: false, error: 'Phòng đã đầy' };
    }

    if (client.data.roomCode !== room.code) this.leaveCurrentRoom(client);
    client.data.roomCode = room.code;
    await client.join(channel(room.code));
    this.presence.add(room.code, user.id, user.displayName, client.id);
    this.broadcastPresence(room.code);
    this.log.log(`${user.displayName} joined ${room.code}`);
    return { ok: true, room };
  }

  /** Clock sync groundwork (Y-03): the client measures round-trip time and offset. */
  @SubscribeMessage(Events.clockPing)
  clock(@MessageBody() body: unknown): ClockPong | { error: string } {
    const parsed = ClockPingInput.safeParse(body);
    if (!parsed.success) return { error: 'bad ping' };
    return { t0: parsed.data.t0, server: Date.now() };
  }

  private leaveCurrentRoom(client: KtvSocket) {
    const code = client.data.roomCode;
    const user = client.data.user;
    if (!code || !user) return;
    void client.leave(channel(code));
    client.data.roomCode = undefined;
    if (this.presence.remove(code, user.id, client.id)) this.broadcastPresence(code);
  }

  private broadcastPresence(code: string) {
    this.ns.to(channel(code)).emit(Events.roomPresence, this.presence.list(code));
  }
}
