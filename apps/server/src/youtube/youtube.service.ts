import { Injectable, Logger } from '@nestjs/common';
import type { SongRef } from '@ktv/shared';
import { config } from '../config.js';

type Check = { ok: true; song: SongRef } | { ok: false; error: string };

/** ISO 8601 duration from the YouTube API, e.g. PT4M13S → 253. */
export function isoDurationToSeconds(iso: string): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, min, s] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

interface VideoItem {
  snippet?: { title?: string; liveBroadcastContent?: string };
  contentDetails?: {
    duration?: string;
    regionRestriction?: { allowed?: string[]; blocked?: string[] };
    contentRating?: { ytRating?: string };
  };
  status?: { embeddable?: boolean; privacyStatus?: string };
}

/** Turns one videos.list item into a song, or the reason it cannot be played here (Y-12). */
export function judgeVideo(id: string, item: VideoItem | undefined, region = 'VN'): Check {
  if (!item) return { ok: false, error: 'Không tìm thấy video này' };
  if (item.status?.embeddable === false) return { ok: false, error: 'Video này không cho phát ngoài YouTube' };
  if (item.status?.privacyStatus === 'private') return { ok: false, error: 'Video này đang để riêng tư' };
  if (item.snippet?.liveBroadcastContent && item.snippet.liveBroadcastContent !== 'none')
    return { ok: false, error: 'Không phát được video đang livestream' };
  if (item.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted')
    return { ok: false, error: 'Video giới hạn độ tuổi không phát được trong phòng' };
  const r = item.contentDetails?.regionRestriction;
  if (r?.blocked?.includes(region) || (r?.allowed && !r.allowed.includes(region)))
    return { ok: false, error: 'Video này bị chặn ở Việt Nam' };
  return {
    ok: true,
    song: {
      kind: 'youtube',
      id,
      title: item.snippet?.title ?? `YouTube ${id}`,
      durationSec: item.contentDetails?.duration ? isoDurationToSeconds(item.contentDetails.duration) : null,
    },
  };
}

@Injectable()
export class YouTubeService {
  private readonly log = new Logger(YouTubeService.name);
  private readonly cache = new Map<string, { at: number; result: Check }>();

  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  /** One videos.list call costs 1 quota unit; results are cached for 24 h. */
  async check(id: string): Promise<Check> {
    const key = config().YOUTUBE_API_KEY;
    if (!key) return { ok: true, song: { kind: 'youtube', id, title: `YouTube ${id}`, durationSec: null } };
    const hit = this.cache.get(id);
    if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.result;
    try {
      const url =
        'https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=' +
        encodeURIComponent(id) +
        '&key=' +
        encodeURIComponent(key);
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`YouTube API ${res.status}`);
      const body = (await res.json()) as { items?: VideoItem[] };
      const result = judgeVideo(id, body.items?.[0]);
      this.cache.set(id, { at: Date.now(), result });
      return result;
    } catch (e) {
      // Quota used up or YouTube unreachable: still let friends sing, just without the checks.
      this.log.warn(`videos.list failed, accepting ${id} unchecked: ${(e as Error).message}`);
      return { ok: true, song: { kind: 'youtube', id, title: `YouTube ${id}`, durationSec: null } };
    }
  }
}
