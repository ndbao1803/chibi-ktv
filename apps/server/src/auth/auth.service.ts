import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { LoginInput, PublicUser, RegisterInput } from '@ktv/shared';
import { DB, type Database } from '../db/db.module.js';
import { users, type User } from '../db/schema.js';

export interface TokenUser {
  id: string;
  displayName: string;
}

const toPublic = (u: User): PublicUser => ({ id: u.id, email: u.email, displayName: u.displayName });

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwt: JwtService,
  ) {}

  async register(input: RegisterInput): Promise<PublicUser> {
    const existing = await this.db.query.users.findFirst({ where: eq(users.email, input.email) });
    if (existing) throw new ConflictException('Email này đã có tài khoản');
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const [user] = await this.db
      .insert(users)
      .values({ email: input.email, displayName: input.displayName, passwordHash })
      .returning();
    return toPublic(user);
  }

  async login(input: LoginInput): Promise<PublicUser> {
    const user = await this.db.query.users.findFirst({ where: eq(users.email, input.email) });
    // Same message for unknown email and wrong password, so nobody can probe which emails exist.
    const ok = user ? await argon2.verify(user.passwordHash, input.password) : false;
    if (!user || !ok) throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    return toPublic(user);
  }

  async findById(id: string): Promise<PublicUser | null> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, id) });
    return user ? toPublic(user) : null;
  }

  sign(user: PublicUser): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, name: user.displayName });
  }

  async verifyToken(token: string | undefined): Promise<TokenUser | null> {
    if (!token) return null;
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; name: string }>(token);
      return { id: p.sub, displayName: p.name };
    } catch {
      return null;
    }
  }
}
