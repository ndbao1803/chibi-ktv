import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';
import { createApp } from '../src/bootstrap.js';

/** Fresh schema + empty tables, then a running app on a random port. */
export async function startTestApp() {
  const url = process.env.DATABASE_URL!;
  await runMigrations(url);
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  await pool.query('truncate table rooms, users restart identity cascade');
  await pool.end();
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as { port: number }).port;
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

/** Pulls the login cookie out of a response so the next request can send it back. */
export function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'] as string[] | undefined;
  const c = raw?.find((x) => x.startsWith('ktv_token='));
  if (!c) throw new Error('no ktv_token cookie');
  return c.split(';')[0];
}
