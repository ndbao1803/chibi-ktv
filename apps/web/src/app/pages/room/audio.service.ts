import { Injectable, signal } from '@angular/core';

/**
 * Browsers only allow sound after the user clicks something (R-03). The room page shows a
 * "Vào phòng" button; its click calls unlock(), which creates the one shared AudioContext.
 */
@Injectable({ providedIn: 'root' })
export class AudioService {
  readonly unlocked = signal(false);
  private context?: AudioContext;

  get ctx(): AudioContext {
    this.context ??= new AudioContext({ latencyHint: 'interactive' });
    return this.context;
  }

  async unlock(): Promise<void> {
    await this.ctx.resume();
    this.unlocked.set(true);
  }

  /** Live loudness (0..1) of a stream, for the chibi's mouth and the mic meter. */
  meter(stream: MediaStream): { level: () => number; stop: () => void } {
    const src = this.ctx.createMediaStreamSource(stream);
    const an = this.ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    return {
      level: () => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        return Math.min(1, Math.sqrt(sum / buf.length) * 4);
      },
      stop: () => src.disconnect(),
    };
  }
}
