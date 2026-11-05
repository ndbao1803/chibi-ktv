import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeScore, scoreComment, firstFreeSeat,
  parseYouTubeId,
  expectedPosition,
  EMPTY_PLAYBACK,
  orderQueue,
  msUntilSongEnd,
  SONG_END_GRACE_SEC,
  skipDecision,
} from '../dist/index.js';

test('parses the usual YouTube link shapes', () => {
  const id = 'dQw4w9WgXcQ';
  for (const link of [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&list=PL123&t=42s`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `youtu.be/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`,
  ]) assert.equal(parseYouTubeId(link), id, link);
});

test('rejects things that are not YouTube videos', () => {
  for (const bad of ['', 'hello', 'https://vimeo.com/123', 'https://www.youtube.com/', 'https://youtu.be/short', 'https://evil.com/watch?v=dQw4w9WgXcQ'])
    assert.equal(parseYouTubeId(bad), null, bad);
});

test('expected position follows the server clock and stops when paused', () => {
  const song = { kind: 'test', id: 'click', title: 't', durationSec: 600 };
  const playing = { ...EMPTY_PLAYBACK, song, paused: false, startedAtServerMs: 10_000 };
  assert.equal(expectedPosition(playing, 12_500), 2.5);
  assert.equal(expectedPosition(playing, 9_000), 0); // before the start: still loading
  assert.equal(expectedPosition({ ...playing, paused: true, pausedAtSec: 7 }, 99_999), 7);
  assert.equal(expectedPosition(EMPTY_PLAYBACK, 5_000), 0);
});

/* ---------- orderQueue (Q-05) ---------- */

const entry = (id, singerId, addedAtMs) => ({ id, song: null, singerId, singerName: singerId, addedAtMs });

test('orderQueue interleaves singers round-robin when nobody has sung yet', () => {
  const [T1, T2, T3, V1] = [entry('T1', 'T', 1), entry('T2', 'T', 2), entry('T3', 'T', 3), entry('V1', 'V', 4)];
  const order = orderQueue([T1, T2, T3, V1], {});
  assert.deepEqual(order.map((e) => e.id), ['T1', 'V1', 'T2', 'T3']);
});

test('orderQueue counts songs already sung this session', () => {
  const [T1, T2, T3, V1] = [entry('T1', 'T', 1), entry('T2', 'T', 2), entry('T3', 'T', 3), entry('V1', 'V', 4)];
  const order = orderQueue([T1, T2, T3, V1], { T: 1 });
  assert.deepEqual(order.map((e) => e.id), ['V1', 'T1', 'T2', 'T3']);
});

test('orderQueue works with a Map and with uneven singer counts', () => {
  const [A1, A2, B1] = [entry('A1', 'A', 1), entry('A2', 'A', 2), entry('B1', 'B', 3)];
  const order = orderQueue([A1, A2, B1], new Map([['A', 3]]));
  // A's entries land at rounds 3 and 4; B's single entry is round 0 and goes first.
  assert.deepEqual(order.map((e) => e.id), ['B1', 'A1', 'A2']);
});

test('orderQueue on an empty queue returns an empty list', () => {
  assert.deepEqual(orderQueue([], {}), []);
});

/* ---------- msUntilSongEnd (Y-11) ---------- */

test('msUntilSongEnd counts down while a song with a known duration plays', () => {
  const song = { kind: 'test', id: 'click', title: 't', durationSec: 180 };
  const p = { ...EMPTY_PLAYBACK, song, paused: false, startedAtServerMs: 0 };
  // At 10s in: (180 + grace - 10) * 1000 remaining.
  assert.equal(msUntilSongEnd(p, 10_000), (180 + SONG_END_GRACE_SEC - 10) * 1000);
});

test('msUntilSongEnd is null while paused', () => {
  const song = { kind: 'test', id: 'click', title: 't', durationSec: 180 };
  const p = { ...EMPTY_PLAYBACK, song, paused: true, pausedAtSec: 10 };
  assert.equal(msUntilSongEnd(p, 999_999), null);
});

test('msUntilSongEnd is null when the duration is unknown', () => {
  const song = { kind: 'youtube', id: 'abc', title: 't', durationSec: null };
  const p = { ...EMPTY_PLAYBACK, song, paused: false, startedAtServerMs: 0 };
  assert.equal(msUntilSongEnd(p, 5_000), null);
});

test('msUntilSongEnd is null when nothing is playing', () => {
  assert.equal(msUntilSongEnd(EMPTY_PLAYBACK, 5_000), null);
});

test('msUntilSongEnd goes to or below zero once the song is already over', () => {
  const song = { kind: 'test', id: 'click', title: 't', durationSec: 60 };
  const p = { ...EMPTY_PLAYBACK, song, paused: false, startedAtServerMs: 0 };
  assert.ok(msUntilSongEnd(p, 120_000) <= 0);
});

/* ---------- skipDecision (Q-07) ---------- */

test('skipDecision: a room of 2, the one listener can skip alone', () => {
  const r = skipDecision(['v1'], ['singer', 'v1'], 'singer');
  assert.deepEqual(r, { have: 1, needed: 1, skip: true });
});

test('skipDecision: a room of 3 needs 1 of 2 non-singers', () => {
  const r = skipDecision(['v1'], ['singer', 'v1', 'v2'], 'singer');
  assert.deepEqual(r, { have: 1, needed: 1, skip: true });
});

test('skipDecision: a room of 8 needs 4 of 7 non-singers', () => {
  const members = ['singer', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'];
  assert.deepEqual(skipDecision(['v1', 'v2', 'v3'], members, 'singer'), { have: 3, needed: 4, skip: false });
  assert.deepEqual(skipDecision(['v1', 'v2', 'v3', 'v4'], members, 'singer'), { have: 4, needed: 4, skip: true });
});

test('skipDecision ignores a vote cast by the singer themselves', () => {
  const members = ['singer', 'v1', 'v2', 'v3'];
  const r = skipDecision(['singer'], members, 'singer');
  assert.deepEqual(r, { have: 0, needed: 2, skip: false });
});

test('skipDecision with just a singer and nobody else: nothing to skip', () => {
  assert.deepEqual(skipDecision([], ['singer'], 'singer'), { have: 0, needed: 1, skip: false });
});

test('score: stars map to 10..100, hype adds up to 10, capped at 100 (G-02, G-03)', () => {
  assert.deepEqual(computeScore([], 0.5), { score: null, bonus: 5 });
  assert.equal(computeScore([1], 0).score, 10);
  assert.equal(computeScore([5, 5], 0).score, 100);
  assert.equal(computeScore([5, 4], 0).score, 89);
  assert.equal(computeScore([5, 5], 1).score, 100); // capped
  assert.equal(computeScore([3], 1).score, 65);
  assert.equal(scoreComment(null), 'Không có đánh giá');
  assert.equal(scoreComment(89), 'Hát hay quá!');
});

test('seats: side sofas first, stools only in rooms of 16 (R-04)', () => {
  assert.equal(firstFreeSeat(new Set(), 8), 6);
  assert.equal(firstFreeSeat(new Set([6, 4, 5, 7, 1, 2, 0, 3]), 8), null);
  assert.equal(firstFreeSeat(new Set([6, 4, 5, 7, 1, 2, 0, 3]), 16), 11);
});
