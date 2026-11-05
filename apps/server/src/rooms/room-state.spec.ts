import { RoomState } from './room-state.js';
import { START_LEAD_MS, expectedPosition } from '@ktv/shared';

const song = { kind: 'test' as const, id: 'click' as const, title: 'Click', durationSec: 600 };

describe('RoomState', () => {
  let now = 1_000_000;
  const clock = () => now;

  it('counts a person with two tabs once, and removes them only when both close', () => {
    const r = new RoomState('ABC123', clock);
    r.addSocket('u1', 'Tuấn', 's1');
    r.addSocket('u1', 'Tuấn', 's2');
    r.addSocket('u2', 'Thảo Vy', 's3');
    expect(r.size).toBe(2);
    expect(r.removeSocket('u1', 's1')).toBe(false);
    expect(r.removeSocket('u1', 's2')).toBe(true);
    expect(r.presence()).toEqual([{ userId: 'u2', displayName: 'Thảo Vy', away: false }]);
  });

  it('starts a new song after a short lead time, pauses and resumes at the same spot', () => {
    const r = new RoomState('ABC123', clock);
    r.setSong(song, 'Tuấn');
    expect(r.playback.startedAtServerMs).toBe(now + START_LEAD_MS);
    now += START_LEAD_MS + 30_000; // 30 s into the song
    expect(r.pause('Minh Anh')).toBe(true);
    expect(r.playback.pausedAtSec).toBeCloseTo(30);
    expect(r.playback.updatedBy).toBe('Minh Anh');
    now += 60_000; // a long pause
    expect(r.resume('Tuấn')).toBe(true);
    expect(expectedPosition(r.playback, now + 600)).toBeCloseTo(30);
    expect(r.playback.rev).toBe(3);
  });

  it('allows one singer; the stage frees up when the singer leaves the room', () => {
    const r = new RoomState('ABC123', clock);
    r.addSocket('u1', 'Tuấn', 's1');
    r.addSocket('u2', 'Thảo Vy', 's2');
    expect(r.takeStage('u1')).toEqual({ ok: true });
    expect(r.takeStage('u2')).toEqual({ ok: false, error: 'Tuấn đang hát' });
    r.removeSocket('u1', 's1');
    expect(r.stage.singerId).toBeNull();
    expect(r.takeStage('u2')).toEqual({ ok: true });
  });

  it('starts a turn when the first song is added: playback, stage and queue all update', () => {
    const r = new RoomState('ABC123', clock);
    r.addSocket('u1', 'Tuấn', 's1');
    const added = r.queue.add(song, 'u1', 'Tuấn', now);
    expect(added.ok).toBe(true);
    const effects = r.startTurnIfIdle();
    expect(effects).toEqual({ playback: true, stage: true, queue: true });
    expect(r.playback.song).toEqual(song);
    expect(r.playback.startedAtServerMs).toBe(now + START_LEAD_MS);
    expect(r.stage).toEqual({ singerId: 'u1', singerName: 'Tuấn' });
    expect(r.queue.current?.entry.singerId).toBe('u1');
  });

  it('advances to the next entry when the turn singer leaves the stage; an empty queue idles the room', () => {
    const r = new RoomState('ABC123', clock);
    r.addSocket('u1', 'Tuấn', 's1');
    r.addSocket('u2', 'Thảo Vy', 's2');
    r.queue.add(song, 'u1', 'Tuấn', now);
    r.queue.add(song, 'u2', 'Thảo Vy', now);
    r.startTurnIfIdle();
    expect(r.stage.singerId).toBe('u1');

    const effects = r.leaveStage('u1');
    expect(effects).toEqual({ playback: true, stage: true, queue: true });
    expect(r.stage.singerId).toBe('u2');

    expect(r.leaveStage('u2')).toEqual({ playback: true, stage: true, queue: true });
    expect(r.stage.singerId).toBeNull();
    expect(r.playback.song).toBeNull();
  });

  it('is a no-op when someone who is not on stage calls stage:leave', () => {
    const r = new RoomState('ABC123', clock);
    r.addSocket('u1', 'Tuấn', 's1');
    r.addSocket('u2', 'Thảo Vy', 's2');
    r.queue.add(song, 'u1', 'Tuấn', now);
    r.startTurnIfIdle();
    expect(r.leaveStage('u2')).toEqual({});
    expect(r.stage.singerId).toBe('u1');
  });

  it('refuses stage:take from someone else while the turn singer is actually on stage', () => {
    const r = new RoomState('ABC123', clock);
    r.addSocket('u1', 'Tuấn', 's1');
    r.addSocket('u2', 'Thảo Vy', 's2');
    r.queue.add(song, 'u1', 'Tuấn', now);
    r.startTurnIfIdle();
    expect(r.takeStage('u2')).toEqual({ ok: false, error: 'Tuấn đang hát' });
  });

  it('skips past an entry whose singer already left the room, instead of stalling the queue', () => {
    const r = new RoomState('ABC123', clock);
    r.addSocket('u2', 'Thảo Vy', 's2');
    r.queue.add(song, 'u1', 'Tuấn', now); // u1 never actually joined this room instance
    r.queue.add(song, 'u2', 'Thảo Vy', now);
    const effects = r.startTurnIfIdle();
    expect(effects).toEqual({ playback: true, stage: true, queue: true });
    expect(r.stage.singerId).toBe('u2');
  });
});

describe('RoomState vote-skip (Q-07)', () => {
  const yt = (n: number) => ({ kind: 'youtube' as const, id: `vid0000000${n}`, title: `Bài ${n}`, durationSec: 200 });
  const now = 5_000_000;

  /** Room with `n` members u1..un; u1 has a turn running, u2 has the next song queued. */
  function room(n: number) {
    const r = new RoomState('ABC123', () => now);
    for (let i = 1; i <= n; i++) r.addSocket(`u${i}`, `Bạn ${i}`, `s${i}`);
    r.queue.add(yt(1), 'u1', 'Bạn 1', now);
    if (n > 1) r.queue.add(yt(2), 'u2', 'Bạn 2', now);
    r.startTurnIfIdle();
    return r;
  }
  const vote = (r: RoomState, id: string, v = true) => {
    const res = r.vote(id, v);
    if (!res.ok) throw new Error(res.error);
    return res.effects;
  };

  it('room of 8: 3 votes do not skip, the 4th does and the next song starts with a notice', () => {
    const r = room(8);
    vote(r, 'u3');
    vote(r, 'u4');
    expect(vote(r, 'u5')).toEqual({ skip: true });
    expect(r.skipState()).toMatchObject({ have: 3, needed: 4, voterNames: ['Bạn 3', 'Bạn 4', 'Bạn 5'] });
    const fx = vote(r, 'u6');
    expect(fx).toMatchObject({ playback: true, stage: true, queue: true, notice: 'Cả phòng đã bỏ qua bài “Bài 1”' });
    expect(r.playback.song?.title).toBe('Bài 2');
    expect(r.stage.singerId).toBe('u2');
  });

  it('votes never carry over: the next song starts at 0 votes', () => {
    const r = room(8);
    ['u3', 'u4', 'u5', 'u6'].forEach((id) => vote(r, id));
    expect(r.skipState()).toMatchObject({ have: 0, voterNames: [] });
  });

  it('room of 2: the one listener skips alone (needed = 1)', () => {
    const r = room(2);
    expect(r.skipState().needed).toBe(1);
    expect(vote(r, 'u2').notice).toBe('Cả phòng đã bỏ qua bài “Bài 1”');
  });

  it('a vote can be taken back', () => {
    const r = room(8);
    vote(r, 'u3');
    vote(r, 'u3', false);
    expect(r.skipState().have).toBe(0);
  });

  it('3 of 8 voted, then 3 others leave: the tick finds it is now enough and skips', () => {
    const r = room(8);
    ['u3', 'u4', 'u5'].forEach((id) => vote(r, id));
    ['u6', 'u7', 'u8'].forEach((id) => r.removeSocket(id, `s${id.slice(1)}`));
    const fx = r.tick(now);
    expect(fx.notice).toBe('Cả phòng đã bỏ qua bài “Bài 1”');
    expect(r.playback.song?.title).toBe('Bài 2');
  });

  it('a voter who leaves loses their vote, and the tick re-broadcasts the new numbers', () => {
    const r = room(8);
    vote(r, 'u3');
    r.removeSocket('u3', 's3');
    expect(r.tick(now)).toEqual({ skip: true });
    expect(r.skipState()).toMatchObject({ have: 0, needed: 3 });
    expect(r.tick(now)).toEqual({}); // nothing new: no broadcast
  });

  it('refuses the singer and an idle room; with an empty stage, everyone present may vote', () => {
    expect(room(3).vote('u1', true)).toEqual({ ok: false, error: 'Ca sĩ dùng “Xuống sân khấu” để bỏ bài của mình' });

    const idle = new RoomState('ABC123', () => now);
    idle.addSocket('u1', 'Bạn 1', 's1');
    expect(idle.vote('u1', true)).toEqual({ ok: false, error: 'Chưa có bài nào đang phát' });

    const alone = room(1);
    alone.stage = { singerId: null, singerName: null }; // e.g. the singer stepped away (phase 05)
    alone.addSocket('u9', 'Khách', 's9');
    alone.removeSocket('u9', 's9');
    expect(alone.vote('u1', true).ok).toBe(true); // with an empty stage, everyone present is eligible
  });
});

describe('RoomState song end and broken videos (Y-11, Y-08)', () => {
  const t0 = 9_000_000;
  let now = t0;
  const yt = (n: number, durationSec: number | null) => ({ kind: 'youtube' as const, id: `vid0000000${n}`, title: `Bài ${n}`, durationSec });

  function room(first: number | null) {
    now = t0;
    const r = new RoomState('ABC123', () => now);
    r.addSocket('u1', 'Tuấn', 's1');
    r.addSocket('u2', 'Thảo Vy', 's2');
    r.queue.add(yt(1, first), 'u1', 'Tuấn', now);
    r.queue.add(yt(2, 180), 'u2', 'Thảo Vy', now);
    r.startTurnIfIdle();
    return r;
  }

  it('ends the song by itself 2 s after its length and starts the next singer', () => {
    const r = room(200);
    const end = r.playback.startedAtServerMs + 200_000;
    expect(r.tick(end)).toEqual({});
    expect(r.tick(end + 1_000)).toEqual({});
    const fx = r.tick(end + 2_000);
    expect(fx.notice).toBe('Hết bài — tới lượt Thảo Vy');
    expect(r.playback.song?.title).toBe('Bài 2');
  });

  it('a paused song never ends by itself', () => {
    const r = room(200);
    now = r.playback.startedAtServerMs + 100_000;
    r.pause('Tuấn');
    expect(r.tick(now + 1_000_000)).toEqual({});
  });

  it('the last song ending idles the room', () => {
    const r = room(200);
    r.leaveStage('u1'); // Thảo Vy's song now, nothing after it
    const fx = r.tick(r.playback.startedAtServerMs + 183_000);
    expect(fx.notice).toBe('Hết bài');
    expect(r.playback.song).toBeNull();
  });

  it('a song of unknown length waits for a browser to report it; the first report wins', () => {
    const r = room(null);
    expect(r.tick(t0 + 10_000_000)).toEqual({}); // cannot end yet
    const rev = r.playback.rev;
    expect(r.reportDuration(rev - 1, 240)).toEqual({}); // stale
    expect(r.reportDuration(rev, 240)).toEqual({ playback: true, queue: true });
    expect(r.playback.song?.durationSec).toBe(240);
    expect(r.reportDuration(r.playback.rev, 999)).toEqual({}); // already known
    expect(r.queue.current?.endsAtServerMs).toBe(r.playback.startedAtServerMs + 242_000);
    expect(r.tick(r.playback.startedAtServerMs + 242_000).notice).toMatch(/^Hết bài/);
  });

  it('skips a video that can never play, but ignores harmless errors and old reports', () => {
    const r = room(200);
    expect(r.reportError(r.playback.rev, 5)).toEqual({}); // HTML5 error: not fatal
    expect(r.reportError(r.playback.rev - 1, 150)).toEqual({}); // about an older song
    const fx = r.reportError(r.playback.rev, 150);
    expect(fx.notice).toBe('Video này không phát được — đã bỏ qua');
    expect(r.playback.song?.title).toBe('Bài 2');
  });
});
