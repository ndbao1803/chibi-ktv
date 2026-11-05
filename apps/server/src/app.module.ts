import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbModule } from './db/db.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RoomsModule } from './rooms/rooms.module.js';
import { HealthController } from './health/health.controller.js';
import { ClientErrorsController } from './telemetry/client-errors.controller.js';

// In production the server also serves the built Angular app (one free Render service).
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist/web/browser'); // apps/server/dist → apps/web/dist
const staticSite = existsSync(webDist)
  ? [ServeStaticModule.forRoot({ rootPath: webDist, exclude: ['/api/{*path}'] })]
  : [];

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
    DbModule,
    AuthModule,
    RoomsModule,
    ...staticSite,
  ],
  controllers: [HealthController, ClientErrorsController],
})
export class AppModule {}
