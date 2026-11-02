import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoginInput, RegisterInput } from '@ktv/shared';
import { AuthService } from '../../core/auth.service';
import { apiError } from '../../core/api-error';

type Mode = 'login' | 'register';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  /** Where to go after login (set by the auth guard), e.g. /room/ABC123 from a shared link. */
  readonly next = input<string>();
  readonly mode = signal<Mode>('login');
  readonly busy = signal(false);
  readonly error = signal('');

  readonly form = this.fb.nonNullable.group({
    displayName: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  switchTo(mode: Mode) {
    this.mode.set(mode);
    this.error.set('');
  }

  async submit() {
    this.error.set('');
    const raw = this.form.getRawValue();
    // The same Zod rules as the server, so mistakes show before a round trip.
    const parsed = this.mode() === 'login' ? LoginInput.safeParse(raw) : RegisterInput.safeParse(raw);
    if (!parsed.success) {
      this.error.set(parsed.error.issues[0]?.message ?? 'Kiểm tra lại thông tin');
      return;
    }
    this.busy.set(true);
    try {
      if (this.mode() === 'login') await this.auth.login(parsed.data as LoginInput);
      else await this.auth.register(parsed.data as RegisterInput);
      await this.router.navigateByUrl(this.next() || '/lobby');
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
