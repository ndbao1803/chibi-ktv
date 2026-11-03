import { isoDurationToSeconds, judgeVideo } from './youtube.service.js';

describe('YouTube checks', () => {
  it('reads ISO 8601 durations', () => {
    expect(isoDurationToSeconds('PT4M13S')).toBe(253);
    expect(isoDurationToSeconds('PT1H2M3S')).toBe(3723);
    expect(isoDurationToSeconds('PT45S')).toBe(45);
    expect(isoDurationToSeconds('nonsense')).toBeNull();
  });

  const ok = {
    snippet: { title: 'Nơi Này Có Anh (Karaoke)', liveBroadcastContent: 'none' },
    contentDetails: { duration: 'PT4M20S' },
    status: { embeddable: true, privacyStatus: 'public' },
  };

  it('accepts a normal karaoke video with its title and length', () => {
    expect(judgeVideo('abcdefghijk', ok)).toEqual({
      ok: true,
      song: { kind: 'youtube', id: 'abcdefghijk', title: 'Nơi Này Có Anh (Karaoke)', durationSec: 260 },
    });
  });

  it('rejects videos that cannot play in the room', () => {
    expect(judgeVideo('x', undefined)).toMatchObject({ ok: false });
    expect(judgeVideo('x', { ...ok, status: { embeddable: false } })).toMatchObject({ error: 'Video này không cho phát ngoài YouTube' });
    expect(judgeVideo('x', { ...ok, contentDetails: { regionRestriction: { blocked: ['VN'] } } })).toMatchObject({ error: 'Video này bị chặn ở Việt Nam' });
    expect(judgeVideo('x', { ...ok, contentDetails: { regionRestriction: { allowed: ['US'] } } })).toMatchObject({ ok: false });
    expect(judgeVideo('x', { ...ok, snippet: { liveBroadcastContent: 'live' } })).toMatchObject({ ok: false });
    expect(judgeVideo('x', { ...ok, contentDetails: { contentRating: { ytRating: 'ytAgeRestricted' } } })).toMatchObject({ ok: false });
  });
});
