/** What the sync loop needs from a player. YouTube and the test click track both implement it. */
export interface KtvPlayer {
  /** True once the player can be asked for its position. */
  readonly ready: boolean;
  /** YouTube can only jump; the test track can also play slightly faster or slower. */
  readonly canChangeRate: boolean;
  position(): number;
  /** Length of the video in seconds, once the player knows it (0 or less = not yet). */
  duration(): number;
  isPlaying(): boolean;
  /** Buffering, an ad, or a stall: the position is not moving although we asked it to play. */
  isWaiting(): boolean;
  play(): void;
  pause(): void;
  seek(sec: number): void;
  setRate(rate: number): void;
  /** 0..100, this listener only (Y-10). */
  setVolume(v: number): void;
  destroy(): void;
}
