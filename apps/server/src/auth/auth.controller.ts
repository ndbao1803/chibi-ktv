import { Body, Controller, Get, HttpCode, NotFoundException, Post, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { LoginInput, RegisterInput, type PublicUser } from '@ktv/shared';
import { AuthService, type TokenUser } from './auth.service.js';
import { AuthGuard, CurrentUser } from './auth.guard.js';
import { clearAuthCookie, setAuthCookie } from './auth.cookie.js';
import { parseOrThrow } from '../validation.js';

@Controller('api/auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<PublicUser> {
    const user = await this.auth.register(parseOrThrow(RegisterInput, body));
    setAuthCookie(res, await this.auth.sign(user));
    return user;
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<PublicUser> {
    const user = await this.auth.login(parseOrThrow(LoginInput, body));
    setAuthCookie(res, await this.auth.sign(user));
    return user;
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    clearAuthCookie(res);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() current: TokenUser): Promise<PublicUser> {
    const user = await this.auth.findById(current.id);
    if (!user) throw new NotFoundException('Tài khoản không còn tồn tại');
    return user;
  }
}
