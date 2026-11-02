import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type pg from 'pg';
import { PG_POOL } from '../db/db.module.js';

@Controller('api/health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  /** Used by Render to check the app is up, and by you to check the database link. */
  @Get()
  async check() {
    try {
      await this.pool.query('select 1');
      return { ok: true, db: 'up', time: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ ok: false, db: 'down' });
    }
  }
}
