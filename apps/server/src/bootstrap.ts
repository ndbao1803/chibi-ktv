import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

/** Shared by main.ts and the tests, so both run the exact same app. */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: process.env.NODE_ENV === 'test' ? ['error', 'warn'] : ['error', 'warn', 'log'],
  });
  app.use(cookieParser());
  app.set('trust proxy', 1); // Render sits behind a proxy; needed for secure cookies.
  app.enableShutdownHooks();
  return app;
}
