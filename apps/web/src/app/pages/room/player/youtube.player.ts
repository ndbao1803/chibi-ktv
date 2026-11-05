import type { KtvPlayer } from './ktv-player';

/* Minimal types for the YouTube IFrame Player API. */
interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  setVolume(v: number): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      width: string;
      height: string;
      videoId: string;
      playerVars: Record<string, number | string>;
      events: { onReady: () => void; onStateChange: (e: { data: number }) => void; onError: (e: { data: number }) => void };
    },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const PLAYING = 1;
const BUFFERING = 3;

let apiLoading: Promise<YTNamespace> | undefined;
/** Loads https://www.youtube.com/iframe_api once. */
function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiLoading ??= new Promise<YTNamespace>((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      apiLoading = undefined;
      reject(new Error('Không tải được trình phát YouTube. Kiểm tra mạng.'));
    };
    document.head.appendChild(s);
  });
  return apiLoading;
}

/** Errors the player reports (Y-08). */
export function youTubeErrorText(code: number): string {
  if (code === 101 || code === 150) return 'Video này không cho phát ngoài YouTube. Chọn bản karaoke khác.';
  if (code === 100) return 'Video đã bị xoá hoặc để riêng tư.';
  if (code === 2) return 'Link video không hợp lệ.';
  return 'Trình phát YouTube gặp lỗi. Thử bài khác.';
}

/**
 * The official YouTube player in a flat panel (P-04: never transformed, never covered, at least 200×200).
 * It can only jump, so the sync loop uses seeks with a learned lead time.
 */
export class YouTubePlayer implements KtvPlayer {
  readonly canChangeRate = false;
  ready = false;
  private player?: YTPlayer;
  private state = -1;
  private lastPos = 0;
  private lastMoveAt = performance.now();
  private wantPlay = false;

  constructor(
    host: HTMLElement,
    videoId: string,
    startSec: number,
    private readonly onError: (message: string, code: number | null) => void,
  ) {
    const el = document.createElement('div');
    host.appendChild(el);
    loadApi()
      .then((YT) => {
        this.player = new YT.Player(el, {
          width: '100%',
          height: '100%',
          videoId,
          playerVars: { playsinline: 1, rel: 0, controls: 1, start: Math.floor(startSec), enablejsapi: 1, origin: location.origin },
          events: {
            onReady: () => {
              this.ready = true;
              if (this.wantPlay) this.player?.playVideo();
            },
            onStateChange: (e) => (this.state = e.data),
            onError: (e) => this.onError(youTubeErrorText(e.data), e.data),
          },
        });
      })
      .catch((e: Error) => this.onError(e.message, null));
  }

  position() {
    const p = this.player && this.ready ? this.player.getCurrentTime() : 0;
    if (Math.abs(p - this.lastPos) > 0.01) {
      this.lastPos = p;
      this.lastMoveAt = performance.now();
    }
    return p;
  }
  duration() {
    return this.player && this.ready ? this.player.getDuration() : 0;
  }
  isPlaying() {
    return this.state === PLAYING;
  }
  /** Buffering, or "playing" while the clock is frozen for 1.5 s (often an ad). Shown outside the player (Y-07). */
  isWaiting() {
    if (!this.wantPlay) return false;
    return this.state === BUFFERING || (this.state === PLAYING && performance.now() - this.lastMoveAt > 1500);
  }
  play() {
    this.wantPlay = true;
    if (this.ready && this.state !== PLAYING && this.state !== BUFFERING) this.player?.playVideo();
  }
  pause() {
    this.wantPlay = false;
    if (this.ready) this.player?.pauseVideo();
  }
  seek(sec: number) {
    if (this.ready) this.player?.seekTo(sec, true);
    this.lastMoveAt = performance.now();
  }
  setRate() {
    /* YouTube only offers coarse speeds; we correct by seeking instead. */
  }
  setVolume(v: number) {
    if (this.ready) this.player?.setVolume(v);
  }
  destroy() {
    this.player?.destroy();
  }
}
