import { Component, computed, effect, ElementRef, inject, input, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TEST_TRACK_LINK } from '@ktv/shared';
import { AuthService } from '../../core/auth.service';
import { RealtimeService } from './realtime.service';
import { VoiceService } from './voice/voice.service';
import { AudioService } from './audio.service';
import { PlayerPanel } from './player/player-panel';
import { KtvScene } from './ktv-scene';

@Component({
  selector: 'app-room-page',
  imports: [FormsModule, PlayerPanel],
  templateUrl: './room.page.html',
  styleUrl: './room.page.scss',
  providers: [RealtimeService, VoiceService], // one connection per visit to a room
})
export class RoomPage implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly rt = inject(RealtimeService);
  protected readonly voice = inject(VoiceService);
  protected readonly audio = inject(AudioService);
  private readonly router = inject(Router);

  /** From the URL /room/:code (component input binding). */
  readonly code = input.required<string>();
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('scene');
  private scene?: KtvScene;

  protected readonly copied = signal(false);
  protected readonly count = computed(() => this.rt.members().length);
  protected readonly isSinger = computed(() => this.voice.role() === 'singer');
  protected readonly askHeadphones = signal(false);
  protected readonly busy = signal(false);
  protected readonly actionError = signal('');
  protected link = '';
  private noticeTimer?: ReturnType<typeof setTimeout>;
  protected readonly toast = signal('');

  constructor() {
    // Whenever the member list or the singer changes, update the 3D room.
    effect(() => this.scene?.setMembers(this.rt.members(), this.auth.user()?.id));
    effect(() => this.scene?.setSinger(this.rt.stage().singerId));
    effect(() => this.scene?.drawScreen(this.rt.playback().song?.title ?? null, this.rt.stage().singerName));
    effect(() => this.flash(this.rt.notice()));
    effect(() => this.flash(this.voice.error()));
  }

  ngOnInit() {
    // ?lite=1 skips the 3D room (slow phones, and the multi-browser sync test).
    if (!new URLSearchParams(location.search).has('lite')) {
      this.scene = new KtvScene(this.canvas().nativeElement);
      this.scene.singerLevel = () => this.voice.singerLevel();
    }
    void this.rt.join(this.code().toUpperCase());
  }

  ngOnDestroy() {
    this.scene?.dispose();
    clearTimeout(this.noticeTimer);
  }

  /** R-03: the click that allows sound in this tab. */
  async enter() {
    await this.audio.unlock();
  }

  async setSong(link: string) {
    this.actionError.set('');
    this.busy.set(true);
    const ack = await this.rt.setSong(link);
    this.busy.set(false);
    if (!ack.ok) this.actionError.set(ack.error);
    else this.link = '';
  }
  playTestTrack() {
    return this.setSong(TEST_TRACK_LINK);
  }
  async togglePause() {
    const ack = this.rt.playback().paused ? await this.rt.resume() : await this.rt.pause();
    if (!ack.ok) this.actionError.set(ack.error);
  }

  /** S-05: singers confirm wired headphones first; without them, echo cancellation stays on. */
  async sing(headphones: boolean) {
    this.askHeadphones.set(false);
    this.busy.set(true);
    const err = await this.voice.startSinging(headphones);
    this.busy.set(false);
    if (err) this.actionError.set(err);
    else if (!headphones) this.flash('Không có tai nghe: nhạc có thể lọt vào micro. Đeo tai nghe có dây sẽ hay hơn.');
  }
  async stopSinging() {
    await this.voice.stopSinging();
  }

  async copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      /* clipboard blocked; the code is still visible */
    }
  }

  leave() {
    void this.router.navigate(['/lobby']);
  }

  private flash(text: string) {
    if (!text) return;
    this.toast.set(text);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.toast.set(''), 3500);
  }
}
