// Tests run against a real PostgreSQL. Locally: `pnpm db:up` (Docker); in CI: a postgres service.
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? 'postgres://ktv:ktv@localhost:5432/ktv_test';
process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough';
process.env.NODE_ENV = 'test';
