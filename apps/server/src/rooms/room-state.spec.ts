import { AWAY_GRACE_MS, RoomState } from './room-state.js';
import { DUET_INVITE_MS } from '@ktv/shared';
import { START_LEAD_MS, expectedPosition } from '@ktv/shared';

const song = { kind: 'test' as const, id: 'click' as const, title: 'Click', durationSec: 600 };

describe('RoomState', () => {
  let now = 1_000_000;
  const clock = () => now;

  it('counts a person with two tabs once; closing both marks them away, the grace then removes them', () => {
    const r = new RoomState('ABC123', clock);
    r.addSocket('u1', 'Tuấn', 's1');
    r.addSocket('u1', 'Tuấn', 's2');
    r.addSocket('u2', 'Thảo Vy', 's3');
    expect(r.size).toBe(2);
    expect(r.removeSocket('u1', 's1')).toBeNull(); // one tab left
    expect(r.removeSocket('u1', 's2')).toEqual({ presence: true });
    expect(r.presence()).toMatchObject([
      { userId: 'u1', displayName: 'Tuấn', away: true, seat: 6 },
      { userId: 'u2', displayName: 'Thảo Vy', away: false, seat: 4 },
    ]);
    expect(r.tick(now + AWAY_GRACE_MS - 1)).toEqual({});
    expect(r.tick(now + AWAY_GRACE_MS)).toMatchObject({ presence: true, queue: true });
    expect(r.presence()).toMatchObject([{ userId: 'u2', displayName: 'Thảo Vy', away: false, seat: 4 }]);
  });

  it('coming back within the grace keeps you in the room as if nothing happened', () => {
    const r = new RoomState('ABC123', clock);
    r.addSocket('u1', 'Tuấn', 's1');
    r.removeSocket('u1', 's1');
    r.addSocket('u1', 'Tuấn', 's9');
    expect(r.tick(now + AWAY_GRACE_MS * 5)).toEqual({});
    expect(r.presence()).toMatchObject([{ userId: 'u1', displayName: 'Tuấn', away: false, seat: 6 }]);
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
    expect(r.takeStage('u1')).toMatchObject({ ok: true });
    expect(r.takeStage('u2')).toEqual({ ok: false, error: 'Tuấn đang hát' });
    r.removeSocket('u1', 's1');
    expect(r.stage.singerId).toBeNull();
    expect(r.takeStage('u2')).toMatchObject({ ok: true });
  });

  it('starts a turn when the first song is added: playback, stage and queue all update', () => {
    const r = new RoomState('ABC123', clock);
    r.addSocket('u1', 'Tuấn', 's1');
    const added = r.queue.add(song, 'u1', 'Tuấn', now);
    expect(added.ok).toBe(true);
    const effects = r.startTurnIfIdle();
    expect(effects).toMatchObject({ playback: true, stage: true, queue: true });
    expect(r.playback.song).toEqual(song);
    expect(r.playback.startedAtServerMs).toBe(now + START_LEAD_MS);
    expect(r.stage).toMatchObject({ singerId: 'u1', singerName: 'Tuấn', partnerId: null });
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
    // Tuấn's song is over, so its rating window opens now (G-03) as the next turn starts.
    expect(effects).toMatchObject({ playback: true, stage: true, queue: true });
    expect(r.stage.singerId).toBe('u2');

    expect(r.leaveStage('u2')).toEqual({ playback: true, stage: true, queue: true, rating: true });
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
    // Tuấn's song is over, so its rating window opens now (G-03) as the next turn starts.
    expect(effects).toMatchObject({ playback: true, stage: true, queue: true });
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
    expect(r.tick(now).notice).toBeUndefined(); // away people still count for 20 s (Decided #1)
    const fx = r.tick(now + AWAY_GRACE_MS);
    expect(fx.notice).toBe('Cả phòng đã bỏ qua bài “Bài 1”');
    expect(r.playback.song?.title).toBe('Bài 2');
  });

  it('a voter who leaves loses their vote, and the tick re-broadcasts the new numbers', () => {
    const r = room(8);
    vote(r, 'u3');
    r.removeSocket('u3', 's3');
    expect(r.skipState()).toMatchObject({ have: 1, needed: 4 }); // still theirs during the grace
    expect(r.tick(now + AWAY_GRACE_MS)).toMatchObject({ skip: true, presence: true });
    expect(r.skipState()).toMatchObject({ have: 0, needed: 3 });
    expect(r.tick(now + AWAY_GRACE_MS)).toEqual({}); // nothing new: no broadcast
  });

  it('refuses the singer and an idle room; with an empty stage, everyone present may vote', () => {
    expect(room(3).vote('u1', true)).toEqual({ ok: false, error: 'Ca sĩ dùng “Xuống sân khấu” để bỏ bài của mình' });

    const idle = new RoomState('ABC123', () => now);
    idle.addSocket('u1', 'Bạn 1', 's1');
    expect(idle.vote('u1', true)).toEqual({ ok: false, error: 'Chưa có bài nào đang phát' });

    const alone = room(1);
    alone.stage = { singerId: null, singerName: null, partnerId: null, partnerName: null }; // e.g. the singer stepped away (phase 05)
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

describe('RoomState singer drops mid-song (R-09, N-12)', () => {
  const t0 = 20_000_000;
  let now = t0;
  const yt = (n: number) => ({ kind: 'youtube' as const, id: `vid0000000${n}`, title: `Bài ${n}`, durationSec: 300 });
  function room() {
    now = t0;
    const r = new RoomState('ABC123', () => now);
    r.addSocket('u1', 'Tuấn', 's1');
    r.addSocket('u2', 'Thảo Vy', 's2');
    r.addSocket('u3', 'Khoa', 's3');
    r.queue.add(yt(1), 'u1', 'Tuấn', now);
    r.queue.add(yt(2), 'u2', 'Thảo Vy', now);
    r.startTurnIfIdle();
    return r;
  }

  it('the music keeps playing, the stage opens, and everyone is told about the 20 s', () => {
    const r = room();
    const song = r.playback;
    const fx = r.removeSocket('u1', 's1')!;
    expect(fx.notice).toMatch(/^Tuấn mất kết nối — bài sẽ dừng sau 20 giây/);
    expect(r.stage.singerId).toBeNull();
    expect(r.playback).toBe(song); // untouched
    expect(r.queue.current?.singerAwayUntilMs).toBe(now + AWAY_GRACE_MS);
  });

  it('nobody keeps it: after 20 s the next song starts', () => {
    const r = room();
    r.removeSocket('u1', 's1');
    expect(r.tick(now + AWAY_GRACE_MS - 1).notice).toBeUndefined();
    const fx = r.tick(now + AWAY_GRACE_MS);
    expect(fx.notice).toBe('Ca sĩ chưa quay lại — chuyển sang bài tiếp theo');
    expect(r.playback.song?.title).toBe('Bài 2');
  });

  it('"Giữ bài" keeps the song (not the stage); then it runs to its normal end', () => {
    const r = room();
    r.removeSocket('u1', 's1');
    expect(r.keepSong('u3')).toEqual({ ok: true, effects: { queue: true, notice: 'Khoa đã giữ bài — cả phòng hát tiếp' } });
    expect(r.tick(now + AWAY_GRACE_MS * 3)).toMatchObject({ presence: true }); // Tuấn's grace ends, song goes on
    expect(r.playback.song?.title).toBe('Bài 1');
    expect(r.stage.singerId).toBeNull();
    expect(r.keepSong('u3')).toEqual({ ok: false, error: 'Không có bài nào cần giữ' });
  });

  it('anyone can step up and finish the song', () => {
    const r = room();
    r.removeSocket('u1', 's1');
    expect(r.takeStage('u3')).toMatchObject({ ok: true, effects: { notice: 'Khoa lên hát tiếp bài này' } });
    expect(r.tick(now + AWAY_GRACE_MS).notice).toBeUndefined();
    expect(r.playback.song?.title).toBe('Bài 1');
  });

  it('the singer back in time gets the stage again, if it is still free', () => {
    const r = room();
    r.removeSocket('u1', 's1');
    expect(r.addSocket('u1', 'Tuấn', 's1b')).toMatchObject({ stage: true, notice: 'Tuấn đã kết nối lại' });
    expect(r.stage.singerId).toBe('u1');
    expect(r.tick(now + AWAY_GRACE_MS * 2)).toEqual({}); // no song stop
  });

  it('back too late to the stage: someone else is singing, so they just listen', () => {
    const r = room();
    r.removeSocket('u1', 's1');
    r.takeStage('u3');
    expect(r.addSocket('u1', 'Tuấn', 's1b')).toEqual({});
    expect(r.stage.singerId).toBe('u3');
  });

  it('a queued singer who is away when their turn comes gets the same 20 s', () => {
    const r = room();
    r.removeSocket('u2', 's2'); // Thảo Vy drops while Tuấn sings
    r.leaveStage('u1'); // Tuấn finishes: Thảo Vy's turn
    expect(r.playback.song?.title).toBe('Bài 2');
    expect(r.stage.singerId).toBeNull();
    expect(r.queue.current?.singerAwayUntilMs).toBe(now + AWAY_GRACE_MS);
  });

  it("someone gone for good loses their queued songs", () => {
    const r = room();
    r.queue.add(yt(3), 'u3', 'Khoa', now);
    r.removeSocket('u3', 's3');
    r.tick(now + AWAY_GRACE_MS);
    expect(r.queue.state().entries.map((e) => e.singerName)).toEqual(['Thảo Vy']);
  });
});

describe('RoomState seats (R-04, R-11..R-13)', () => {
  let now = 1_000;
  const room = (capacity = 8) => {
    const r = new RoomState('ABC123', () => now);
    r.capacity = capacity;
    return r;
  };
  const seatOf = (r: RoomState, id: string) => r.presence().find((m) => m.userId === id)?.seat;

  it('gives arrivals the side sofas first, then the back sofa', () => {
    const r = room();
    ['a', 'b', 'c', 'd', 'e'].forEach((id) => r.addSocket(id, id, `s-${id}`));
    expect(r.presence().map((m) => m.seat)).toEqual([6, 4, 5, 7, 1]);
  });

  it('moving frees the old seat at once; the first click on a seat wins', () => {
    const r = room();
    r.addSocket('a', 'An', 's1');
    r.addSocket('b', 'Bình', 's2');
    expect(r.takeSeat('a', 0)).toEqual({ ok: true, effects: { presence: true } });
    expect(r.takeSeat('b', 0)).toEqual({ ok: false, error: 'An vừa ngồi vào ghế này' });
    expect(r.takeSeat('b', 6)).toMatchObject({ ok: true }); // An's old seat is free again
    expect(r.takeSeat('a', 0)).toEqual({ ok: true, effects: {} }); // already there: no broadcast
  });

  it('a room of 8 has no stools; a room of 16 fills them last', () => {
    expect(room(8).takeSeat('x', 9)).toMatchObject({ ok: false });
    const r = room(8);
    r.addSocket('x', 'X', 's');
    expect(r.takeSeat('x', 9)).toEqual({ ok: false, error: 'Phòng này không có ghế đó' });
    const big = room(16);
    for (let i = 0; i < 9; i++) big.addSocket(`u${i}`, `U${i}`, `s${i}`);
    expect(seatOf(big, 'u8')).toBe(11);
  });

  it('keeps the seat while away and on stage; frees it when they leave for good', () => {
    const r = room();
    r.addSocket('a', 'An', 's1');
    r.takeStage('a');
    expect(seatOf(r, 'a')).toBe(6); // on stage: seat held (R-13)
    r.removeSocket('a', 's1');
    expect(seatOf(r, 'a')).toBe(6); // away: still held
    r.addSocket('b', 'Bình', 's2');
    expect(seatOf(r, 'b')).toBe(4);
    r.tick(now + AWAY_GRACE_MS);
    r.addSocket('c', 'Chi', 's3');
    expect(seatOf(r, 'c')).toBe(6); // freed, and first in the fill order again
  });
});

describe('RoomState duets (S-07..S-12)', () => {
  let now = 50_000_000;
  const yt = (n: number) => ({ kind: 'youtube' as const, id: `vid0000000${n}`, title: `Bài ${n}`, durationSec: 200 });
  function room() {
    now = 50_000_000;
    const r = new RoomState('ABC123', () => now);
    r.addSocket('a', 'An', 'sa');
    r.addSocket('b', 'Bình', 'sb');
    r.addSocket('c', 'Chi', 'sc');
    r.addSong(yt(0), 'c', undefined); // Chi is singing, so the next songs wait in the queue
    return r;
  }

  it('an invite goes to the partner only, with the song, the inviter and its place in the queue', () => {
    const r = room();
    const added = r.addSong(yt(1), 'a', 'b');
    if (!added.ok) throw new Error(added.error);
    expect(added.effects.invite).toEqual({
      toId: 'b',
      invite: { entryId: added.entryId, title: 'Bài 1', fromName: 'An', position: 1, expiresAtMs: now + DUET_INVITE_MS },
    });
    expect(r.queue.state().entries[0].invite).toMatchObject({ toId: 'b', toName: 'Bình' });
  });

  it('yes makes it a duet and tells the inviter; no keeps it solo', () => {
    const r = room();
    const one = r.addSong(yt(1), 'a', 'b');
    if (!one.ok) throw new Error();
    expect(r.answerInvite('c', one.entryId, true)).toEqual({ ok: false, error: 'Lời mời này không còn nữa' });
    expect(r.answerInvite('b', one.entryId, true)).toEqual({
      ok: true,
      effects: { queue: true, tell: [{ userId: 'a', text: 'Bình đã đồng ý song ca “Bài 1”' }] },
    });
    expect(r.queue.state().entries[0]).toMatchObject({ partnerId: 'b', partnerName: 'Bình', invite: null });
    const two = r.addSong(yt(2), 'b', 'a');
    if (!two.ok) throw new Error();
    expect(r.answerInvite('a', two.entryId, false)).toMatchObject({ effects: { tell: [{ userId: 'b', text: 'An từ chối song ca — bài vẫn để bạn hát một mình' }] } });
  });

  it('no answer in 30 s: solo, and the inviter is told; the inviter can also cancel', () => {
    const r = room();
    r.addSong(yt(1), 'a', 'b');
    expect(r.tick(now + DUET_INVITE_MS)).toMatchObject({ queue: true, tell: [{ userId: 'a' }] });
    expect(r.queue.state().entries[0].invite).toBeNull();
    const again = r.addSong(yt(2), 'a', 'b');
    if (!again.ok) throw new Error();
    expect(r.cancelInvite('b', again.entryId)).toEqual({ ok: false, error: 'Không có lời mời nào để huỷ' });
    expect(r.cancelInvite('a', again.entryId)).toEqual({ ok: true, effects: { queue: true } });
  });

  it('refuses inviting yourself, someone who left, or someone who turned invites off (S-11)', () => {
    const r = room();
    expect(r.addSong(yt(1), 'a', 'a')).toMatchObject({ ok: false });
    r.setInvitesOpen('b', false);
    expect(r.addSong(yt(1), 'a', 'b')).toEqual({ ok: false, error: 'Bình đang tắt nhận lời mời song ca' });
    expect(r.presence().find((m) => m.userId === 'b')?.invites).toBe(false);
  });

  it('a duet turn puts both on stage; the partner can step down alone and cannot vote to skip', () => {
    const r = room();
    const one = r.addSong(yt(1), 'a', 'b');
    if (!one.ok) throw new Error();
    r.answerInvite('b', one.entryId, true);
    r.leaveStage('c'); // Chi finishes
    expect(r.stage).toEqual({ singerId: 'a', singerName: 'An', partnerId: 'b', partnerName: 'Bình' });
    expect(r.vote('b', true)).toMatchObject({ ok: false });
    expect(r.skipState().needed).toBe(1); // only Chi votes
    r.leaveStage('b');
    expect(r.stage).toMatchObject({ singerId: 'a', partnerId: null });
  });

  it('an invite still open when the song starts lapses: solo, and the inviter is told', () => {
    const r = room();
    r.addSong(yt(1), 'a', 'b');
    const fx = r.leaveStage('c');
    expect(fx.tell).toEqual([{ userId: 'a', text: 'Bình chưa trả lời — bạn hát một mình bài này nhé' }]);
    expect(r.stage).toMatchObject({ singerId: 'a', partnerId: null });
  });
});

describe('RoomState mics and cheers (VC-01, VC-04, VC-10)', () => {
  it('allows at most 8 open mics; push-to-talk is always fine', () => {
    const r = new RoomState('ABC123');
    for (let i = 0; i < 10; i++) r.addSocket(`u${i}`, `U${i}`, `s${i}`);
    for (let i = 0; i < 8; i++) expect(r.setMicMode(`u${i}`, 'open')).toMatchObject({ ok: true });
    expect(r.setMicMode('u8', 'open')).toMatchObject({ ok: false });
    expect(r.setMicMode('u8', 'ptt')).toEqual({ ok: true, effects: { presence: true } });
    expect(r.presence().find((m) => m.userId === 'u8')?.mic).toBe('ptt');
  });

  it('one cheer per 3 seconds per person', () => {
    let now = 1000;
    const r = new RoomState('ABC123', () => now);
    r.addSocket('u1', 'Tuấn', 's1');
    expect(r.sendFx('u1', 'cheer')).toEqual({ ok: true, effects: { fx: { userId: 'u1', kind: 'cheer', atMs: now }, party: true } });
    now += 2999;
    expect(r.sendFx('u1', 'cheer')).toMatchObject({ ok: false });
    now += 1;
    expect(r.sendFx('u1', 'cheer')).toMatchObject({ ok: true });
  });
});

describe('RoomState party layer (Phase 5)', () => {
  let now = 70_000_000;
  const yt = (n: number, durationSec: number | null = 200) => ({ kind: 'youtube' as const, id: `vid0000000${n}`, title: `Bài ${n}`, durationSec });
  function room() {
    now = 70_000_000;
    const r = new RoomState('ABC123', () => now);
    r.addSocket('a', 'An', 'sa');
    r.addSocket('b', 'Bình', 'sb');
    r.addSocket('c', 'Chi', 'sc');
    return r;
  }

  it('shaking fills the hype meter; a full meter starts an 8 s crowd dance (M-06, FM-03)', () => {
    const r = room();
    r.setShaking('a', true);
    r.setShaking('b', true);
    r.setShaking('c', true);
    for (let i = 0; i < 10 && !r.party.state().danceUntilMs; i++) {
      now += 1000;
      r.tick(now);
    }
    expect(r.party.state().danceUntilMs).toBeGreaterThan(now);
    expect(r.party.state().hype).toBe(0.25);
    now += 8000;
    r.tick(now);
    expect(r.party.state().danceUntilMs).toBeNull();
  });

  it('limits shake messages to 8 a second (M-03)', () => {
    const r = room();
    let sent = 0;
    for (let i = 0; i < 20; i++) if (r.party.setShaking('a', i % 2 === 0) !== undefined) sent += r.party['shakeTimes'].get('a')!.length > 8 ? 0 : 1;
    expect(r.party['shakeTimes'].get('a')!.length).toBe(8);
  });

  it('flowers need someone on stage; no flowers or pranks from the stage; cụng ly once a minute per room', () => {
    const r = room();
    expect(r.sendFx('a', 'flower')).toEqual({ ok: false, error: 'Chưa có ai trên sân khấu để tặng hoa' });
    r.addSong(yt(1), 'a');
    expect(r.sendFx('a', 'flower')).toMatchObject({ ok: false });
    expect(r.sendFx('a', 'fart')).toMatchObject({ ok: false });
    expect(r.sendFx('b', 'flower')).toMatchObject({ ok: true });
    expect(r.sendFx('b', 'cungly')).toMatchObject({ ok: true });
    expect(r.sendFx('c', 'cungly')).toEqual({ ok: false, error: 'Vừa cụng ly xong — đợi một chút nhé' });
  });

  it('chat: 5 messages per 10 s, /me lines, last 50 kept, joins in the same stream (CH-01..CH-04, CH-11)', () => {
    const r = room();
    expect(r.party.history().map((m) => m.text)).toEqual(['An vào phòng', 'Bình vào phòng', 'Chi vào phòng']);
    for (let i = 0; i < 5; i++) expect(r.say('a', `câu ${i}`)).toMatchObject({ ok: true });
    expect(r.say('a', 'câu 6')).toMatchObject({ ok: false });
    now += 10_000;
    expect(r.say('a', '/me nhảy lên ghế')).toMatchObject({ ok: true, effects: { chat: [{ kind: 'me', text: 'nhảy lên ghế', name: 'An' }] } });
    for (let i = 0; i < 60; i++) r.party.system(`x${i}`);
    expect(r.party.history()).toHaveLength(50);
  });

  it('rating opens 30 s before the end, singers cannot rate, the score goes out after the window (G-01..G-06)', () => {
    const r = room();
    r.addSong(yt(1, 100), 'a'); // ends at now + START_LEAD + 102 s
    const key = r.queue.current!.entry.id;
    expect(r.rate('b', key, 5)).toMatchObject({ ok: false }); // not open yet
    const ends = r.queue.current!.endsAtServerMs!;
    now = ends - 30_000;
    expect(r.tick(now)).toMatchObject({ rating: true });
    expect(r.party.ratingState()).toMatchObject({ turnKey: key, singerNames: ['An'] });
    expect(r.rate('a', key, 5)).toEqual({ ok: false, error: 'Ca sĩ không tự chấm điểm mình được' });
    expect(r.rate('b', key, 5)).toMatchObject({ ok: true });
    expect(r.rate('c', key, 4)).toMatchObject({ ok: true });
    expect(r.party.ratingState()?.count).toBe(2);
    now = ends; // the song ends: the window stays open 10 s more
    r.tick(now);
    now = ends + 10_000;
    const fx = r.tick(now);
    expect(fx.score).toMatchObject({ singerNames: ['An'], ratings: 2, comment: expect.any(String) });
    expect(fx.score!.score).toBeGreaterThanOrEqual(88);
    expect(fx.chat?.[0].text).toMatch(/^🎤 An: \d+ điểm/);
    expect(r.party.leaderboard()).toEqual([{ name: 'An', best: fx.score!.score, songs: 1 }]);
  });

  it('a skipped song still gets a 10 s rating window; nobody rating shows "Không có đánh giá"', () => {
    const r = room();
    r.addSong(yt(1, null), 'a');
    r.leaveStage('a');
    expect(r.party.ratingState()?.closesAtMs).toBe(now + 10_000);
    now += 10_000;
    expect(r.tick(now).score).toMatchObject({ score: null, comment: 'Không có đánh giá' });
    expect(r.party.leaderboard()).toEqual([]);
  });
});
