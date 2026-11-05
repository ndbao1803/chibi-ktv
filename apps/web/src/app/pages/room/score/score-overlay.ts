import { TranslatePipe } from '../../../core/i18n';
import { Component, computed, effect, inject, OnDestroy, signal, untracked } from '@angular/core';
import type { ScoreResult } from '@ktv/shared';
import { AuthService } from '../../../core/auth.service';
import { RealtimeService } from '../realtime.service';

/**
 * Rating and scores (G-01..G-06): a star card while the rating window is open (not for the
 * singers), the KTV-style score screen with a count-up after every song, and the night's
 * leaderboard with "Ca sĩ của đêm".
 */
@Component({
  selector: 'app-score-overlay',
  imports: [TranslatePipe],
  templateUrl: './score-overlay.html',
  styleUrl: './score-overlay.scss',
})
export class ScoreOverlay implements OnDestroy {
  protected readonly rt = inject(RealtimeService);
  private readonly auth = inject(AuthService);

  /** My stars for the open window, so the card shows what I gave. */
  protected readonly given = signal<{ key: string; stars: number } | null>(null);
  protected readonly shown = signal<ScoreResult | null>(null);
  protected readonly counter = signal(0);
  protected readonly board = signal(false);
  private hideTimer?: ReturnType<typeof setTimeout>;
  private countTimer?: ReturnType<typeof setInterval>;
  private readonly now = signal(Date.now());
  private readonly tick = setInterval(() => this.now.set(this.rt.serverNow()), 500);

  /** G-06: no card for the people being rated. */
  protected readonly card = computed(() => {
    const r = this.rt.rating();
    const me = this.auth.user()?.id;
    return r && me && !r.singerIds.includes(me) ? r : null;
  });
  protected readonly secondsLeft = computed(() => {
    const r = this.rt.rating();
    return r && r.closesAtMs < 8.64e15 ? Math.max(0, Math.ceil((r.closesAtMs - this.now()) / 1000)) : null;
  });
  protected readonly myStars = computed(() => {
    const g = this.given(), r = this.card();
    return g && r && g.key === r.turnKey ? g.stars : 0;
  });

  constructor() {
    effect(() => {
      const s = this.rt.score();
      if (s) untracked(() => this.show(s));
    });
  }

  async rate(stars: number) {
    const r = this.card();
    if (!r) return;
    this.given.set({ key: r.turnKey, stars });
    const ack = await this.rt.rate(r.turnKey, stars);
    if (!ack.ok) this.given.set(null);
  }

  /** G-01: count up from 0 over ~2 s (a drumroll feel), then keep the result up a few seconds. */
  private show(s: ScoreResult) {
    clearTimeout(this.hideTimer);
    clearInterval(this.countTimer);
    this.shown.set(s);
    this.counter.set(0);
    const target = s.score ?? 0;
    const start = performance.now();
    this.countTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - start) / 2000);
      this.counter.set(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k >= 1) clearInterval(this.countTimer);
    }, 40);
    this.hideTimer = setTimeout(() => this.shown.set(null), 7000);
  }

  close() {
    this.shown.set(null);
  }

  ngOnDestroy() {
    clearTimeout(this.hideTimer);
    clearInterval(this.countTimer);
    clearInterval(this.tick);
  }
}
