import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseYouTubeId, expectedPosition, EMPTY_PLAYBACK } from '../dist/index.js';

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
