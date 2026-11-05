import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import type { INestApplication } from '@nestjs/common';
import { Events, RT_NAMESPACE, type JoinAck, type PlaybackState, type PresenceList, type QueueState, type RoomInfo, type StageState } from '@ktv/shared';
import { cookieFrom, startTestApp } from './helpers.js';

/**
 * The whole Phase 2 story over real sockets and a real database: three friends queue songs,
 * the order is round-robin, you can only remove your own, and a dropped singer does not stop the music.
 */
describe('Queue and turns (e2e, Q-03, Q-05, Q-06, R-09, N-12)', () => {
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
  const link = (id: string) => `https://youtu.be/${id}`;

  beforeAll(async () => {
    ({ app, baseUrl } = await startTestApp());
    http = request(app.getHttpServer());
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await app.close();
  });

  it('three friends: round-robin order, remove only your own, a dropped singer keeps the song playing', async () => {
    const [ca, cb, cc] = await Promise.all([
      signup('q-an@example.com', 'An'),
      signup('q-binh@example.com', 'Bình'),
      signup('q-chi@example.com', 'Chi'),
    ]);
    const code = ((await http.post('/api/rooms').set('Cookie', ca).send({})).body as RoomInfo).code;
    const [a, b, c] = await Promise.all([connect(ca), connect(cb), connect(cc)]);
    for (const s of [a, b, c]) await s.emitWithAck(Events.roomJoin, { code });

    // An queues three, Bình one, Chi one. An's first starts at once.
    const started = once<StageState>(c, Events.stageState);
    await a.emitWithAck(Events.queueAdd, { link: link('aaaaaaaaaa1') });
    expect(await started).toMatchObject({ singerName: 'An' });

    // N-04: queue changes reach the others quickly. Measure a few round trips.
    const trips: number[] = [];
    for (const [s, id] of [[a, 'aaaaaaaaaa2'], [a, 'aaaaaaaaaa3'], [b, 'bbbbbbbbbb1'], [c, 'cccccccccc1']] as const) {
      const seen = once<QueueState>(b === s ? c : b, Events.queueState);
      const t0 = performance.now();
      expect(await s.emitWithAck(Events.queueAdd, { link: link(id) })).toMatchObject({ ok: true });
      await seen;
      trips.push(performance.now() - t0);
    }
    console.log(`queue:add → queue:state round trips (ms): ${trips.map((t) => t.toFixed(1)).join(', ')}`);
    expect(Math.max(...trips)).toBeLessThan(200);

    const join = (await c.emitWithAck(Events.roomJoin, { code })) as JoinAck;
    if (!join.ok) throw new Error(join.error);
    // An has already sung once, so Bình and Chi come before An's second song.
    expect(join.queue.entries.map((e) => `${e.singerName}:${e.song.id}`)).toEqual([
      'Bình:bbbbbbbbbb1',
      'Chi:cccccccccc1',
      'An:aaaaaaaaaa2',
      'An:aaaaaaaaaa3',
    ]);

    // Q-06: only your own entries.
    const ansLast = join.queue.entries[3];
    expect(await b.emitWithAck(Events.queueRemove, { entryId: ansLast.id })).toEqual({ ok: false, error: 'Chỉ xoá được bài của bạn' });
    const shrunk = once<QueueState>(b, Events.queueState);
    expect(await a.emitWithAck(Events.queueRemove, { entryId: ansLast.id })).toEqual({ ok: true });
    expect((await shrunk).entries).toHaveLength(3);

    // R-09: An drops mid-song. The stage opens at once; the music does not change.
    const before = (await b.emitWithAck(Events.roomJoin, { code })) as JoinAck;
    const stageOpen = once<StageState>(b, Events.stageState);
    a.close();
    expect(await stageOpen).toEqual({ singerId: null, singerName: null });
    const during = (await b.emitWithAck(Events.roomJoin, { code })) as JoinAck;
    if (!before.ok || !during.ok) throw new Error('join failed');
    expect(during.playback).toEqual(before.playback);
    expect(during.queue.current?.singerAwayUntilMs).toEqual(expect.any(Number));

    // N-12: An comes back within the grace and gets the empty stage back; the queue is intact.
    const back = await connect(ca);
    const onStage = once<StageState>(b, Events.stageState);
    const rejoin = (await back.emitWithAck(Events.roomJoin, { code })) as JoinAck;
    expect(await onStage).toMatchObject({ singerName: 'An' });
    if (!rejoin.ok) throw new Error(rejoin.error);
    expect(rejoin.queue.entries.map((e) => e.singerName)).toEqual(['Bình', 'Chi', 'An']);

    // An finishes: Bình's turn.
    const next = once<PlaybackState>(c, Events.playState);
    await back.emitWithAck(Events.stageLeave);
    expect((await next).song).toMatchObject({ id: 'bbbbbbbbbb1' });
  });

  it('seats: arrivals get one, moving is shared with everyone, a taken seat is refused (R-11..R-13)', async () => {
    const [ca, cb] = await Promise.all([signup('seat-an@example.com', 'An'), signup('seat-binh@example.com', 'Bình')]);
    const code = ((await http.post('/api/rooms').set('Cookie', ca).send({ capacity: 8 })).body as RoomInfo).code;
    const [a, b] = await Promise.all([connect(ca), connect(cb)]);
    await a.emitWithAck(Events.roomJoin, { code });
    const seen = once<PresenceList>(a, Events.roomPresence);
    await b.emitWithAck(Events.roomJoin, { code });
    expect((await seen).map((m) => m.seat)).toEqual([6, 4]);

    const moved = once<PresenceList>(b, Events.roomPresence);
    expect(await a.emitWithAck(Events.seatTake, { seat: 1 })).toEqual({ ok: true });
    expect((await moved).find((m) => m.displayName === 'An')?.seat).toBe(1);
    expect(await b.emitWithAck(Events.seatTake, { seat: 1 })).toEqual({ ok: false, error: 'An vừa ngồi vào ghế này' });
    expect(await b.emitWithAck(Events.seatTake, { seat: 99 })).toEqual({ ok: false, error: 'Ghế không hợp lệ' });
  });
});
