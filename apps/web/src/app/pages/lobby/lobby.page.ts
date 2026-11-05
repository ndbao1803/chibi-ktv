import { TranslatePipe } from '../../core/i18n';
import { LangSwitch } from '../../core/lang-switch';
import { RouterLink } from '@angular/router';
import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { RoomCode, type RoomInfo } from '@ktv/shared';
import { AuthService } from '../../core/auth.service';
import { apiError } from '../../core/api-error';

@Component({
  selector: 'app-lobby-page',
  imports: [FormsModule, TranslatePipe, LangSwitch, RouterLink],
  templateUrl: './lobby.page.html',
  styleUrl: './lobby.page.scss',
})
export class LobbyPage {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  roomName = 'Đêm karaoke';
  capacity: 8 | 16 = 8;
  code = '';
  readonly busy = signal(false);
  readonly error = signal('');

  async create() {
    this.busy.set(true);
    this.error.set('');
    try {
      const room = await firstValueFrom(this.http.post<RoomInfo>('/api/rooms', { name: this.roomName, capacity: this.capacity }));
      await this.router.navigate(['/room', room.code]);
    } catch (e) {
      this.error.set(apiError(e));
    } finally {
      this.busy.set(false);
    }
  }

  async join() {
    const parsed = RoomCode.safeParse(this.code);
    if (!parsed.success) {
      this.error.set(parsed.error.issues[0]?.message ?? 'Mã phòng không hợp lệ');
      return;
    }
    await this.router.navigate(['/room', parsed.data]);
  }

  async logout() {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
