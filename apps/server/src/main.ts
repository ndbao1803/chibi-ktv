import { existsSync } from 'node:fs';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { createApp } from './bootstrap.js';

// Local development: read apps/server/.env if it exists (Render sets real env vars instead).
if (existsSync('.env')) process.loadEnvFile('.env');

const cfg = config();
await runMigrations(cfg.DATABASE_URL);
const app = await createApp();
await app.listen(cfg.PORT, '0.0.0.0');
console.log(`Chibi KTV server on http://localhost:${cfg.PORT}`);
