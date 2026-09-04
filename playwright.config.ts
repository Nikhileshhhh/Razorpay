import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:5175';

// Browser end-to-end tests.
//
// There is deliberately NO `webServer` here. The Vite dev server is started
// in-process by the worker-scoped fixture in tests/e2e/fixtures.ts and closed in
// a `finally` block, which avoids the Windows external-process lifecycle hang
// (Playwright could not terminate the spawned Vite child, so the run never
// exited). Because the fixture binds a fixed port (5173, strictPort), the suite
// runs with a single worker to avoid port contention.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
