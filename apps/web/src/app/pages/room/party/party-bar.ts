import { Component, computed, inject, input, OnDestroy, output, signal } from '@angular/core';
import { PROPS, REACTIONS, type FxKind, type Prop } from '@ktv/shared';
import { AuthService } from '../../../core/auth.service';
import { RealtimeService } from '../realtime.service';

const PROP_LABEL: Record<Prop, string> = { maracas: '🪇 Maracas', lightstick: '🪄 Lightstick', tambourine: '🥁 Lục lạc', clap: '👏 Vỗ tay' };

type MotionPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * The crowd's toys (M-01..M-07, FM-01, FM-02, FM-05): pick a prop, hold Space (or the big button,
 * or shake the phone) to shake it, react with emoji, throw flowers, start a cụng ly, or prank.
 */
@Component({
  selector: 'app-party-bar',
  templateUrl: './party-bar.html',
  styleUrl: './party-bar.scss',
})
export class PartyBar implements OnDestroy {
  private readonly rt = inject(RealtimeService);
  private readonly auth = inject(AuthService);
  /** I am on stage: no props, flowers or pranks from there. */
  readonly onStage = input(false);
  /** Errors from the server (cooldowns) go to the page's toast. */
  readonly message = output<string>();

  protected readonly props = PROPS.map((p) => ({ id: p, label: PROP_LABEL[p] }));
  protected readonly reactions = Object.entries(REACTIONS) as [FxKind, string][];
  protected readonly shaking = signal(false);
  protected readonly motionOn = signal(false);
  /** Phone shaking only makes sense on a phone or tablet (M-05). */
  protected readonly touch = matchMedia('(pointer: coarse)').matches;
  protected readonly myProp = computed(() => this.rt.members().find((m) => m.userId === this.auth.user()?.id)?.prop ?? 'maracas');
  protected readonly someoneOnStage = computed(() => !!this.rt.stage().singerId || !!this.rt.stage().partnerId);
  private motionUntil = 0;
  private motionTimer?: ReturnType<typeof setInterval>;

  constructor() {
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.stop);
  }

  async pick(prop: Prop) {
    const ack = await this.rt.setProp(prop);
    if (!ack.ok) this.message.emit(ack.error);
  }

  shake(on: boolean) {
    if (on && this.onStage()) return;
    if (on === this.shaking()) return;
    this.shaking.set(on);
    this.rt.setShaking(on);
  }

  async fx(kind: FxKind) {
    const ack = await this.rt.sendFx(kind);
    if (!ack.ok) this.message.emit(ack.error);
  }

  /** M-05: shake the phone. iPhone asks for permission, and only from a tap. */
  async toggleMotion() {
    if (this.motionOn()) {
      this.motionOn.set(false);
      window.removeEventListener('devicemotion', this.onMotion);
      clearInterval(this.motionTimer);
      this.shake(false);
      return;
    }
    const DM = (window as unknown as { DeviceMotionEvent?: MotionPermission }).DeviceMotionEvent;
    if (!DM) {
      this.message.emit('Máy này không đo được chuyển động.');
      return;
    }
    if (DM.requestPermission && (await DM.requestPermission().catch(() => 'denied')) !== 'granted') {
      this.message.emit('Cần cho phép “Chuyển động & hướng” để lắc điện thoại.');
      return;
    }
    this.motionOn.set(true);
    window.addEventListener('devicemotion', this.onMotion);
    // Stop shaking 400 ms after the phone is still again.
    this.motionTimer = setInterval(() => this.shaking() && performance.now() > this.motionUntil && this.shake(false), 150);
  }

  private onMotion = (e: DeviceMotionEvent) => {
    const a = e.acceleration ?? e.accelerationIncludingGravity;
    if (!a) return;
    const g = e.acceleration ? 0 : 9.8;
    const mag = Math.abs(Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0) - g);
    if (mag > 12) {
      this.motionUntil = performance.now() + 400;
      this.shake(true);
    }
  };

  private keyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (e.code !== 'Space' || e.repeat || t?.closest('input, textarea, button, select, [contenteditable]')) return;
    e.preventDefault();
    this.shake(true);
  };
  private keyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') this.shake(false);
  };
  private stop = () => this.shake(false);

  ngOnDestroy() {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.stop);
    window.removeEventListener('devicemotion', this.onMotion);
    clearInterval(this.motionTimer);
  }
}
