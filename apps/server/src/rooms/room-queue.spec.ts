import { RoomQueue } from './room-queue.js';
import { MAX_QUEUE_PER_USER, MAX_QUEUE_TOTAL } from '@ktv/shared';

const song = (id: string) => ({ kind: 'youtube' as const, id, title: id, durationSec: 180 });

describe('RoomQueue', () => {
  it('orders round-robin and keeps adding at the back of each singer’s own turn', () => {
    const q = new RoomQueue();
    q.add(song('a1'), 'A', 'An', 1);
    q.add(song('a2'), 'A', 'An', 2);
    q.add(song('b1'), 'B', 'Bình', 3);
    expect(q.ordered().map((e) => e.id).length).toBe(3);
    const order = q.ordered().map((e) => `${e.singerId}:${e.song.id}`);
    expect(order).toEqual(['A:a1', 'B:b1', 'A:a2']);
  });

  it('counts songs already sung so five queued early do not take every turn', () => {
    const q = new RoomQueue();
    q.sung('A');
    q.add(song('a1'), 'A', 'An', 1);
    q.add(song('b1'), 'B', 'Bình', 2);
    const order = q.ordered().map((e) => `${e.singerId}:${e.song.id}`);
    expect(order).toEqual(['B:b1', 'A:a1']);
  });

  it('refuses a 6th pending song from the same person', () => {
    const q = new RoomQueue();
    for (let i = 0; i < MAX_QUEUE_PER_USER; i++) expect(q.add(song(`a${i}`), 'A', 'An', i).ok).toBe(true);
    expect(q.add(song('a-extra'), 'A', 'An', 99)).toEqual({ ok: false, error: 'Bạn đang có 5 bài trong danh sách rồi' });
  });

  it('refuses once the room total is full', () => {
    const q = new RoomQueue();
    for (let i = 0; i < MAX_QUEUE_TOTAL; i++) {
      const r = q.add(song(`s${i}`), `u${i}`, `U${i}`, i);
      expect(r.ok).toBe(true);
    }
    expect(q.add(song('one-too-many'), 'uX', 'UX', 999)).toEqual({ ok: false, error: 'Danh sách phòng đã đầy' });
  });

  it('only lets the owner remove their own pending entry', () => {
    const q = new RoomQueue();
    const added = q.add(song('a1'), 'A', 'An', 1);
    expect(added.ok).toBe(true);
    const entryId = (added as { ok: true; entryId: string }).entryId;
    expect(q.removeOwn(entryId, 'B')).toEqual({ ok: false, error: 'Chỉ xoá được bài của bạn' });
    expect(q.removeOwn(entryId, 'A')).toEqual({ ok: true });
    expect(q.ordered()).toEqual([]);
  });

  it('shifts the head of the round-robin order and bumps rev on every change', () => {
    const q = new RoomQueue();
    const before = q.state().rev;
    q.add(song('a1'), 'A', 'An', 1);
    expect(q.state().rev).toBeGreaterThan(before);
    const next = q.shift();
    expect(next?.song.id).toBe('a1');
    expect(q.ordered()).toEqual([]);
  });
});
