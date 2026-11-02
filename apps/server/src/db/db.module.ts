import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { config } from '../config.js';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');
export type Database = NodePgDatabase<typeof schema>;

/** Closes the connection pool when the app stops. */
@Injectable()
class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => {
        const url = config().DATABASE_URL;
        // Hosted databases such as Neon require TLS; local Docker does not.
        const ssl = /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: false } : undefined;
        return new pg.Pool({ connectionString: url, ssl, max: 5 });
      },
    },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: pg.Pool) => drizzle(pool, { schema }) },
    PoolCloser,
  ],
  exports: [DB, PG_POOL],
})
export class DbModule {}
