import { defineConfig } from 'vitest/config';

// Unit and integration tests run under Vitest (Node environment).
// Browser end-to-end tests run under Playwright (tests/e2e) and are excluded here.
//
// Database integration tests create/migrate/drop a real ephemeral PostgreSQL
// database per test file; CREATE DATABASE + a full migration legitimately
// takes longer than Vitest's 5s/10s JS-only defaults, so both timeouts are
// raised for the whole suite (harmless for fast unit tests).
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.mjs',
      'tests/integration/**/*.test.ts',
    ],
    exclude: ['tests/e2e/**', 'tests/adversarial/**', 'node_modules/**'],
    globals: false,
    setupFiles: ['tests/setup-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Each integration file creates and drops a database on the same PostgreSQL
    // server. Vitest 3 does not apply the legacy poolOptions thread cap, so the
    // complete suite must serialize files to avoid catalog-lock starvation and
    // to guarantee teardown after an earlier setup failure.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
