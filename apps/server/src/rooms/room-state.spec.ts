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
