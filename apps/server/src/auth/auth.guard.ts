import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type TokenUser } from './auth.service.js';
import { AUTH_COOKIE } from './auth.cookie.js';

type AuthedRequest = Request & { user?: TokenUser };

/** Lets a request through only with a valid login cookie, and attaches the user. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.auth.verifyToken(req.cookies?.[AUTH_COOKIE]);
    if (!user) throw new UnauthorizedException('Bạn cần đăng nhập');
    req.user = user;
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TokenUser => ctx.switchToHttp().getRequest<AuthedRequest>().user!,
);
