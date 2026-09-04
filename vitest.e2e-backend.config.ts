import { defineConfig } from 'vitest/config';

// Backend E2E (backend PRD §19.4): real Fastify HTTP server + real
// transactional outbox + real pg-boss worker against a fresh migrated
// PostgreSQL database. Kept in a dedicated config (not `vitest.config.ts`'s
// `tests/unit`/`tests/integration` include list) so `npm test` and
// `npm run test:integration` never silently pick it up — it is invoked only
// via the documented `npm run test:e2e:backend` command, deliberately
// separate from the Playwright web smoke (`npm run test:e2e`).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e-backend/**/*.test.ts'],
    globals: false,
    setupFiles: ['tests/setup-env.ts'],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
