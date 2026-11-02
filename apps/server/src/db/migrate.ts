import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Applies the SQL files in /drizzle that have not run yet. Safe to run on every start. */
export async function runMigrations(url: string): Promise<void> {
  const ssl = /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({ connectionString: url, ssl, max: 1 });
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Both dist/db (built) and src/db (tests) sit two levels below apps/server, where /drizzle lives.
  const folder = path.resolve(here, '../../drizzle');
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  await runMigrations(url);
  console.log('Migrations applied');
}
