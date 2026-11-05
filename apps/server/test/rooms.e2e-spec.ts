import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import type { INestApplication } from '@nestjs/common';
import {
  Events,
  RT_NAMESPACE,
  type JoinAck,
  type PlaybackState,
  type PresenceList,
  type RoomInfo,
  type RtcSignalFromServer,
  type StageState,
} from '@ktv/shared';
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

    // Closing the tab does not remove you at once: you stay "away" for 20 s (N-10).
    const afterLeave = once<PresenceList>(sa, Events.roomPresence);
    sb.close();
    expect((await afterLeave).map((m) => [m.displayName, m.away]).sort()).toEqual([['Thảo Vy', true], ['Tuấn', false]]);

    // Coming back in time keeps your place.
    const sb2 = connect(b);
    await once(sb2, 'connect');
    const back = once<PresenceList>(sa, Events.roomPresence);
    await sb2.emitWithAck(Events.roomJoin, { code: room.code });
    expect((await back).map((m) => [m.displayName, m.away]).sort()).toEqual([['Thảo Vy', false], ['Tuấn', false]]);
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

describe('Playback, stage and WebRTC relay (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let http: ReturnType<typeof request>;
  const sockets: Socket[] = [];

  const signup = async (email: string, displayName: string) =>
    cookieFrom(await http.post('/api/auth/register').send({ email, password: 'password-123', displayName }).expect(201));
  const connect = async (cookie: string) => {
    const s = io(baseUrl + RT_NAMESPACE, { transports: ['websocket'], extraHeaders: { cookie }, reconnection: false });
    sockets.push(s);
    await new Promise<void>((r) => s.once('connect', () => r()));
    return s;
  };
  const once = <T>(s: Socket, ev: string) => new Promise<T>((r) => s.once(ev, r));

  let a: Socket, b: Socket, code: string, bId: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startTestApp());
    http = request(app.getHttpServer());
    const ca = await signup('singer@example.com', 'Ca sĩ');
    const cb = await signup('fan@example.com', 'Fan');
    bId = (await http.get('/api/auth/me').set('Cookie', cb)).body.id;
    code = ((await http.post('/api/rooms').set('Cookie', ca).send({})).body as RoomInfo).code;
    a = await connect(ca);
    b = await connect(cb);
    await a.emitWithAck(Events.roomJoin, { code });
    await b.emitWithAck(Events.roomJoin, { code });
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await app.close();
  });

  it('setting the test track starts it for everyone a moment in the future', async () => {
    const seenByB = once<PlaybackState>(b, Events.playState);
    const ack = await a.emitWithAck(Events.playSet, { link: 'test:click' });
    expect(ack).toEqual({ ok: true });
    const p = await seenByB;
    expect(p.song?.kind).toBe('test');
    expect(p.paused).toBe(false);
    expect(p.startedAtServerMs).toBeGreaterThan(Date.now());
    expect(p.updatedBy).toBe('Ca sĩ');
  });

  it('play:set rejects garbage and YouTube links alike (YouTube now goes through the queue)', async () => {
    const rejected = { ok: false, error: 'Hãy dùng "Thêm vào danh sách" để hát YouTube' };
    expect(await a.emitWithAck(Events.playSet, { link: 'https://vimeo.com/1' })).toEqual(rejected);
    expect(await a.emitWithAck(Events.playSet, { link: 'https://youtu.be/dQw4w9WgXcQ' })).toEqual(rejected);
  });

  it('anyone can pause and resume; the name of who did it is shared', async () => {
    const paused = once<PlaybackState>(a, Events.playState);
    await b.emitWithAck(Events.playPause);
    expect(await paused).toMatchObject({ paused: true, updatedBy: 'Fan' });
    const resumed = once<PlaybackState>(a, Events.playState);
    await b.emitWithAck(Events.playResume);
    expect((await resumed).paused).toBe(false);
  });

  it('one singer at a time, shared with the room', async () => {
    const seen = once<StageState>(b, Events.stageState);
    expect(await a.emitWithAck(Events.stageTake)).toEqual({ ok: true });
    expect(await seen).toEqual({ singerId: expect.any(String), singerName: 'Ca sĩ' });
    expect(await b.emitWithAck(Events.stageTake)).toEqual({ ok: false, error: 'Ca sĩ đang hát' });
  });

  it('relays WebRTC setup messages to the named person only, tagged with the sender', async () => {
    const got = once<RtcSignalFromServer>(b, Events.rtcSignal);
    expect(await a.emitWithAck(Events.rtcSignal, { to: bId, data: { type: 'offer', sdp: 'v=0 fake' } })).toEqual({ ok: true });
    const msg = await got;
    expect(msg.data).toEqual({ type: 'offer', sdp: 'v=0 fake' });
    expect(msg.from).not.toBe(bId);
  });

  it('frees the stage at once when the singer disconnects (R-09: the music itself keeps going)', async () => {
    const seen = once<StageState>(b, Events.stageState);
    a.close();
    expect(await seen).toEqual({ singerId: null, singerName: null });
  });

  it('gives free STUN servers to logged-in users', async () => {
    const cookie = await signup('ice@example.com', 'Ice');
    const res = await http.get('/api/rtc/ice').set('Cookie', cookie).expect(200);
    expect(JSON.stringify(res.body.iceServers)).toContain('stun:stun.cloudflare.com:3478');
    await http.get('/api/rtc/ice').expect(401);
  });
});

describe('Vote-skip (e2e, Q-07)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let http: ReturnType<typeof request>;
  const sockets: Socket[] = [];

  const signup = async (email: string, displayName: string) =>
    cookieFrom(await http.post('/api/auth/register').send({ email, password: 'password-123', displayName }).expect(201));
  const connect = async (cookie: string) => {
    const s = io(baseUrl + RT_NAMESPACE, { transports: ['websocket'], extraHeaders: { cookie }, reconnection: false });
    sockets.push(s);
    await new Promise<void>((r) => s.once('connect', () => r()));
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

  it('two friends: the listener votes once, the song is skipped and everyone is told', async () => {
    const ca = await signup('skip-singer@example.com', 'Ca sĩ');
    const cb = await signup('skip-fan@example.com', 'Fan');
    const code = ((await http.post('/api/rooms').set('Cookie', ca).send({})).body as RoomInfo).code;
    const a = await connect(ca);
    const b = await connect(cb);
    await a.emitWithAck(Events.roomJoin, { code });
    const joined = (await b.emitWithAck(Events.roomJoin, { code })) as JoinAck;
    expect(joined.ok && joined.skip).toMatchObject({ have: 0, needed: 1 });

    // Nothing is playing yet: voting is refused.
    expect(await b.emitWithAck(Events.skipVote, { vote: true })).toEqual({ ok: false, error: 'Chưa có bài nào đang phát' });

    const started = once<PlaybackState>(b, Events.playState);
    expect(await a.emitWithAck(Events.queueAdd, { link: 'https://youtu.be/dQw4w9WgXcQ' })).toMatchObject({ ok: true });
    expect((await started).song).toMatchObject({ id: 'dQw4w9WgXcQ' });

    // The singer cannot vote on their own song.
    expect(await a.emitWithAck(Events.skipVote, { vote: true })).toEqual({
      ok: false,
      error: 'Ca sĩ dùng “Xuống sân khấu” để bỏ bài của mình',
    });

    const notice = once<string>(a, 'room:notice');
    const stopped = once<PlaybackState>(a, Events.playState);
    expect(await b.emitWithAck(Events.skipVote, { vote: true })).toEqual({ ok: true });
    expect(await notice).toMatch(/^Cả phòng đã bỏ qua bài/);
    expect((await stopped).song).toBeNull(); // queue was empty: the room goes idle
  });

  it('the singer drops mid-song: the room is told, and a listener can keep the song going', async () => {
    const ca = await signup('keep-singer@example.com', 'Ca sĩ');
    const cb = await signup('keep-fan@example.com', 'Fan');
    const code = ((await http.post('/api/rooms').set('Cookie', ca).send({})).body as RoomInfo).code;
    const a = await connect(ca);
    const b = await connect(cb);
    await a.emitWithAck(Events.roomJoin, { code });
    await b.emitWithAck(Events.roomJoin, { code });
    expect(await b.emitWithAck(Events.turnKeep, {})).toEqual({ ok: false, error: 'Không có bài nào cần giữ' });

    const started = once<PlaybackState>(b, Events.playState);
    await a.emitWithAck(Events.queueAdd, { link: 'https://youtu.be/dQw4w9WgXcQ' });
    await started;

    const dropped = once<string>(b, 'room:notice');
    a.close();
    expect(await dropped).toMatch(/^Ca sĩ mất kết nối — bài sẽ dừng sau 20 giây/);

    const kept = once<string>(b, 'room:notice');
    expect(await b.emitWithAck(Events.turnKeep, {})).toEqual({ ok: true });
    expect(await kept).toBe('Fan đã giữ bài — cả phòng hát tiếp');
  });

  it('rejects a malformed vote', async () => {
    const c = await signup('skip-bad@example.com', 'Bad');
    const code = ((await http.post('/api/rooms').set('Cookie', c).send({})).body as RoomInfo).code;
    const s = await connect(c);
    await s.emitWithAck(Events.roomJoin, { code });
    expect(await s.emitWithAck(Events.skipVote, { vote: 'yes please' })).toEqual({ ok: false, error: 'Phiếu bầu không hợp lệ' });
  });
});

describe('Song length and broken videos (e2e, Y-11, Y-08)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let http: ReturnType<typeof request>;
  const sockets: Socket[] = [];
  const signup = async (email: string, displayName: string) =>
    cookieFrom(await http.post('/api/auth/register').send({ email, password: 'password-123', displayName }).expect(201));
  const connect = async (cookie: string) => {
    const s = io(baseUrl + RT_NAMESPACE, { transports: ['websocket'], extraHeaders: { cookie }, reconnection: false });
    sockets.push(s);
    await new Promise<void>((r) => s.once('connect', () => r()));
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

  it('a reported length is shared with everyone; a fatal player error skips to the next song', async () => {
    const ca = await signup('len-a@example.com', 'An');
    const cb = await signup('len-b@example.com', 'Bình');
    const code = ((await http.post('/api/rooms').set('Cookie', ca).send({})).body as RoomInfo).code;
    const a = await connect(ca);
    const b = await connect(cb);
    await a.emitWithAck(Events.roomJoin, { code });
    await b.emitWithAck(Events.roomJoin, { code });

    const first = once<PlaybackState>(b, Events.playState);
    await a.emitWithAck(Events.queueAdd, { link: 'https://youtu.be/dQw4w9WgXcQ' });
    const p = await first;
    expect(p.song?.durationSec).toBeNull(); // no API key in tests: length unknown until a player reports it
    await b.emitWithAck(Events.queueAdd, { link: 'https://youtu.be/9bZkp7svik8' });

    const timed = once<PlaybackState>(a, Events.playState);
    expect(await b.emitWithAck(Events.playDuration, { rev: p.rev, durationSec: 213 })).toEqual({ ok: true });
    expect((await timed).song?.durationSec).toBe(213);

    const notice = once<string>(a, 'room:notice');
    const next = once<PlaybackState>(a, Events.playState);
    const current = (await a.emitWithAck(Events.roomJoin, { code })) as JoinAck; // fresh snapshot for the rev
    const rev = current.ok ? current.playback.rev : -1;
    expect(await b.emitWithAck(Events.playError, { rev, code: 150 })).toEqual({ ok: true });
    expect(await notice).toBe('Video này không phát được — đã bỏ qua');
    expect((await next).song).toMatchObject({ id: '9bZkp7svik8' });
  });

  it('rejects nonsense lengths', async () => {
    const c = await signup('len-bad@example.com', 'Bad');
    const code = ((await http.post('/api/rooms').set('Cookie', c).send({})).body as RoomInfo).code;
    const s = await connect(c);
    await s.emitWithAck(Events.roomJoin, { code });
    expect(await s.emitWithAck(Events.playDuration, { rev: 1, durationSec: 1 })).toEqual({ ok: false, error: 'Thời lượng không hợp lệ' });
  });
});
