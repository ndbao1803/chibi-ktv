import { TranslatePipe } from '../../../core/i18n';
import { Component, computed, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CHAT_MAX, parseYouTubeId, QUICK_PHRASES, type ChatMessage } from '@ktv/shared';
import { AuthService } from '../../../core/auth.service';
import { RealtimeService } from '../realtime.service';

const LINK = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/\S+/i;

/** One message, with the pieces the template needs worked out once. */
interface Line {
  msg: ChatMessage;
  mine: boolean;
  /** Mentions me with @name (CH-06). */
  forMe: boolean;
  /** A YouTube link in it, offered as "Thêm vào hàng chờ" (CH-07). */
  link: string | null;
}

/**
 * The room chat (CH-01..CH-10): a collapsible panel, Enter to send, quick karaoke phrases and
 * emoji, @mentions, YouTube links you can queue in one click, and /hat, /skip, /me.
 * No sound for chat, so it never plays over the singer (CH-09).
 */
@Component({
  selector: 'app-chat-panel',
  imports: [FormsModule, TranslatePipe],
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.scss',
})
export class ChatPanel {
  protected readonly rt = inject(RealtimeService);
  private readonly auth = inject(AuthService);
  /** I am on stage: chat waits until I come down (CH-10). */
  readonly singing = input(false);

  protected readonly open = signal(readOpen());
  protected readonly unread = signal(0);
  /** A signal, not a plain field: the app runs without zone.js, so only signals re-render the Send button. */
  protected readonly text = signal('');
  protected readonly error = signal('');
  protected readonly phrases = QUICK_PHRASES;
  protected readonly emoji = ['😂', '❤️', '🔥', '👏', '🎤', '🥳', '😭', '🙌'];
  protected readonly max = CHAT_MAX;
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private seen = 0;

  protected readonly lines = computed<Line[]>(() => {
    const me = this.auth.user();
    const at = me ? `@${me.displayName.toLowerCase()}` : null;
    return this.rt.chat().map((msg) => ({
      msg,
      mine: msg.userId === me?.id,
      forMe: !!at && msg.userId !== me?.id && msg.text.toLowerCase().includes(at),
      link: LINK.exec(msg.text)?.[0] ?? null,
    }));
  });
  protected readonly showing = computed(() => this.open() && !this.singing());

  constructor() {
    // New messages: count them while hidden, otherwise keep the newest in view.
    effect(() => {
      const n = this.rt.chat().length;
      const visible = this.showing();
      untracked(() => {
        if (visible) {
          this.unread.set(0);
          this.seen = n;
          queueMicrotask(() => this.list()?.nativeElement.scrollTo({ top: 1e9 }));
        } else if (n > this.seen) {
          this.unread.set(this.unread() + (n - this.seen));
          this.seen = n;
        }
      });
    });
  }

  toggle() {
    this.open.set(!this.open());
    try {
      localStorage.setItem('ktv.chatOpen', this.open() ? '1' : '0');
    } catch {
      /* not remembered */
    }
  }

  async send(text = this.text()) {
    const t = text.trim();
    if (!t) return;
    this.error.set('');
    // CH-08: /skip votes, /hat <link> queues it for me; /me goes to the server as an action line.
    if (/^\/skip\b/i.test(t)) {
      const ack = await this.rt.voteSkip(true);
      this.done(ack.ok ? '' : ack.error);
      return;
    }
    const hat = /^\/hat\s+(\S+)/i.exec(t);
    if (hat) {
      const ack = await this.rt.addToQueue(hat[1]);
      this.done(ack.ok ? '' : ack.error);
      return;
    }
    const ack = await this.rt.sendChat(t);
    this.done(ack.ok ? '' : ack.error);
  }

  protected addEmoji(e: string) {
    this.text.set((this.text() + e).slice(0, CHAT_MAX));
  }

  /** CH-07: queue a song someone posted, with me as the singer. */
  async queueLink(link: string) {
    if (!parseYouTubeId(link)) return;
    const ack = await this.rt.addToQueue(link);
    this.error.set(ack.ok ? '' : ack.error);
  }

  protected time(ms: number) {
    const d = new Date(ms);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  private done(error: string) {
    this.error.set(error);
    if (!error) this.text.set('');
  }
}

function readOpen(): boolean {
  try {
    const v = localStorage.getItem('ktv.chatOpen');
    if (v !== null) return v === '1';
  } catch {
    /* storage blocked */
  }
  return !matchMedia('(max-width: 860px)').matches;
}
