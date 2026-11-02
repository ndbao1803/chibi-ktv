import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import type { INestApplication } from '@nestjs/common';
import { Events, RT_NAMESPACE, type JoinAck, type PresenceList, type RoomInfo } from '@ktv/shared';
import { cookieFrom, startTestApp } from './helpers.js';

describe('Rooms + realtime presence (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let http: ReturnType<typeof request>;
  const sockets: Socket[] = [];

  const signup = async (name: string) =>
    cookieFrom(
      await http
        .post('/api/auth/register')
        .send({ email: `${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s/g, '')}@example.com`, password: 'password-123', displayName: name })
        .expect(201),
    );

  const connect = (cookie?: string) => {
    const s = io(baseUrl + RT_NAMESPACE, { transports: ['websocket'], extraHeaders: cookie ? { cookie } : {}, reconnection: false });
    sockets.push(s);
    return s;
  };
  const once = <T>(s: Socket, ev: string) => new Promise<T>((r) => s.once(ev, r));

  beforeAll(async () => {
    ({ app, baseUrl } = await startTestApp());
    http = request(app.getHttpServer());
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await app.close();
  });

  it('creates a room with a readable 6-character code', async () => {
    const cookie = await signup('Minh Anh');
    const res = await http.post('/api/rooms').set('Cookie', cookie).send({ name: 'Đêm thứ Sáu' }).expect(201);
    const room = res.body as RoomInfo;
    expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(room).toMatchObject({ name: 'Đêm thứ Sáu', capacity: 8, ownerName: 'Minh Anh' });
    await http.get(`/api/rooms/${room.code.toLowerCase()}`).set('Cookie', cookie).expect(200);
  });

  it('needs a login to create a room', async () => {
    await http.post('/api/rooms').send({}).expect(401);
  });

  it('refuses a socket without a login cookie', async () => {
    const s = connect();
    await once(s, 'disconnect');
    expect(s.connected).toBe(false);
  });

  it('two friends join and both see each other online; leaving updates the list', async () => {
    const a = await signup('Tuấn');
    const b = await signup('Thảo Vy');
    const room = (await http.post('/api/rooms').set('Cookie', a).send({}).expect(201)).body as RoomInfo;

    const sa = connect(a);
    await once(sa, 'connect');
    const ackA = (await sa.emitWithAck(Events.roomJoin, { code: room.code })) as JoinAck;
    expect(ackA.ok).toBe(true);

    const sb = connect(b);
    await once(sb, 'connect');
    const seenByA = once<PresenceList>(sa, Events.roomPresence);
    await sb.emitWithAck(Events.roomJoin, { code: room.code });
    expect((await seenByA).map((m) => m.displayName).sort()).toEqual(['Thảo Vy', 'Tuấn']);

    const afterLeave = once<PresenceList>(sa, Events.roomPresence);
    sb.close();
    expect((await afterLeave).map((m) => m.displayName)).toEqual(['Tuấn']);
  });

  it('rejects an unknown room code', async () => {
    const s = connect(await signup('Khoa'));
    await once(s, 'connect');
    const ack = (await s.emitWithAck(Events.roomJoin, { code: 'ZZZZZZ' })) as JoinAck;
    expect(ack).toEqual({ ok: false, error: 'Không tìm thấy phòng' });
  });

  it('answers clock pings with the server time', async () => {
    const s = connect(await signup('Lan Chi'));
    await once(s, 'connect');
    const t0 = Date.now();
    const pong = (await s.emitWithAck(Events.clockPing, { t0 })) as { t0: number; server: number };
    expect(pong.t0).toBe(t0);
    expect(Math.abs(pong.server - Date.now())).toBeLessThan(1000);
  });
});
