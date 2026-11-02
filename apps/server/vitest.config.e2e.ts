import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup-e2e.ts'],
    fileParallelism: false, // both files share one test database
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
