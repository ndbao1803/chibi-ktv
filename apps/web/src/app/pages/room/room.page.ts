import { Component, computed, effect, ElementRef, inject, input, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { RealtimeService } from './realtime.service';
import { KtvScene } from './ktv-scene';

@Component({
  selector: 'app-room-page',
  templateUrl: './room.page.html',
  styleUrl: './room.page.scss',
  providers: [RealtimeService], // one connection per visit to a room
})
export class RoomPage implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly rt = inject(RealtimeService);
  private readonly router = inject(Router);

  /** From the URL /room/:code (component input binding). */
  readonly code = input.required<string>();
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('scene');
  private scene?: KtvScene;

  protected readonly copied = signal(false);
  protected readonly count = computed(() => this.rt.members().length);

  constructor() {
    // Whenever the member list changes, update the chibis in the 3D room.
    effect(() => this.scene?.setMembers(this.rt.members(), this.auth.user()?.id));
  }

  ngOnInit() {
    this.scene = new KtvScene(this.canvas().nativeElement);
    void this.rt.join(this.code().toUpperCase());
  }

  ngOnDestroy() {
    this.scene?.dispose();
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
}
