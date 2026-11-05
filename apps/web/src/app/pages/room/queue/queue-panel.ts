import { TranslatePipe } from '../../../core/i18n';
import { Component, computed, inject, OnDestroy, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { QueueEntry } from '@ktv/shared';
import { AuthService } from '../../../core/auth.service';
import { RealtimeService } from '../realtime.service';

/** "m:ss" for a countdown; never negative. */
export function formatLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * "Danh sách bài" (Q-03, Q-05, Q-06, Q-07): paste a link to queue a song, see whose turn it is and
 * who is next in round-robin order, remove your own entries, and vote to skip the current song.
 * Everything shown here comes from server broadcasts; this component keeps no queue state itself.
 */
@Component({
  selector: 'app-queue-panel',
  imports: [FormsModule, TranslatePipe],
  templateUrl: './queue-panel.html',
  styleUrl: './queue-panel.scss',
})
export class QueuePanel implements OnDestroy {
  protected readonly rt = inject(RealtimeService);
  private readonly auth = inject(AuthService);

  /** Fired after my song was accepted, so the page can ask for mic permission early (S-02). */
  readonly added = output<{ startedNow: boolean }>();

  /** Signals (not plain fields): with zoneless Angular only signals re-render the button state. */
  protected readonly link = signal('');
  /** S-07: "Hát một mình" or "Mời song ca" with one member. */
  protected readonly who = signal<'solo' | 'duet'>('solo');
  protected readonly partnerId = signal('');
  /** People I can invite: present, not me, invites on (S-11). */
  protected readonly invitable = computed(() => this.rt.members().filter((m) => m.userId !== this.meId() && !m.away && m.invites));
  protected readonly myInvitesOpen = computed(() => this.rt.members().find((m) => m.userId === this.meId())?.invites ?? true);
  protected readonly busy = signal(false);
  /** Server rejection (blocked video, too many songs…); stays until the next attempt (E-01). */
  protected readonly error = signal('');

  /** Re-evaluates the countdown once a second. */
  private readonly now = signal(this.rt.serverNow());
  private readonly timer = setInterval(() => this.now.set(this.rt.serverNow()), 1000);

  protected readonly meId = computed(() => this.auth.user()?.id ?? null);
  protected readonly current = computed(() => this.rt.queue()?.current ?? null);
  protected readonly entries = computed<QueueEntry[]>(() => this.rt.queue()?.entries ?? []);
  protected readonly left = computed(() => {
    const ends = this.current()?.endsAtServerMs;
    return ends == null || this.rt.playback().paused ? null : formatLeft(ends - this.now());
  });

  /** Skip: shown to everyone except the person whose song it is (they use "Xuống sân khấu"). */
  protected readonly canSkip = computed(() => {
    const cur = this.current();
    return !!cur && cur.entry.singerId !== this.meId() && this.rt.members().length > 1;
  });
  protected readonly iVoted = computed(() => {
    const me = this.auth.user()?.displayName;
    return !!me && !!this.rt.skip()?.voterNames.includes(me);
  });

  async add() {
    const link = this.link().trim();
    if (!link) return;
    this.error.set('');
    this.busy.set(true);
    const startedNow = !this.current();
    const partner = this.who() === 'duet' ? this.partnerId() || undefined : undefined;
    if (this.who() === 'duet' && !partner) {
      this.busy.set(false);
      this.error.set('Chọn một người để mời song ca');
      return;
    }
    const ack = await this.rt.addToQueue(link, partner);
    this.busy.set(false);
    if (!ack.ok) {
      this.error.set(ack.error);
      return;
    }
    this.link.set('');
    this.who.set('solo');
    this.partnerId.set('');
    this.added.emit({ startedNow });
  }

  async remove(e: QueueEntry) {
    const ack = await this.rt.removeFromQueue(e.id);
    if (!ack.ok) this.error.set(ack.error);
  }

  async cancelInvite(e: QueueEntry) {
    const ack = await this.rt.cancelInvite(e.id);
    if (!ack.ok) this.error.set(ack.error);
  }

  async setInvites(open: boolean) {
    const ack = await this.rt.setInvitesOpen(open);
    if (!ack.ok) this.error.set(ack.error);
  }

  async toggleSkip() {
    const ack = await this.rt.voteSkip(!this.iVoted());
    if (!ack.ok) this.error.set(ack.error);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }
}
