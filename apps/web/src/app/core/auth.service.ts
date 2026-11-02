import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { LoginInput, PublicUser, RegisterInput } from '@ktv/shared';

/**
 * Holds who is logged in. The login itself lives in an httpOnly cookie that the
 * browser sends automatically; this service only keeps the user's public details.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  readonly user = signal<PublicUser | null>(null);
  readonly loggedIn = computed(() => this.user() !== null);

  async loadSession(): Promise<void> {
    try {
      this.user.set(await firstValueFrom(this.http.get<PublicUser>('/api/auth/me')));
    } catch {
      this.user.set(null);
    }
  }

  async register(input: RegisterInput): Promise<void> {
    this.user.set(await firstValueFrom(this.http.post<PublicUser>('/api/auth/register', input)));
  }

  async login(input: LoginInput): Promise<void> {
    this.user.set(await firstValueFrom(this.http.post<PublicUser>('/api/auth/login', input)));
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/logout', {}));
    this.user.set(null);
  }
}
