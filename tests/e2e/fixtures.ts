import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

/**
 * In-process Vite dev server for the browser E2E suite.
 *
 * Root cause of the previous hang: Playwright's `webServer` spawns Vite as an
 * external Node child. On Windows, Playwright's teardown cannot reliably
 * terminate that child (Vite keeps the event loop alive and the kill signal is
 * not propagated to the grandchild), so the run never prints its summary and
 * never returns to the shell.
 *
 * Fix: run Vite INSIDE the Playwright worker process via this worker-scoped,
 * automatic fixture. There is no external process to kill — the server is closed
 * with an awaited in-process `server.close()` in a `finally` block, so it is torn
 * down on every path: normal success, assertion failure, setup failure after
 * server creation, retries, and with CI=1.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VITE_CONFIG = resolve(repoRoot, 'vite.config.ts');
const HOST = '127.0.0.1';
const PORT = 5175;

interface WorkerFixtures {
  viteServer: ViteDevServer;
}

export const test = base.extend<object, WorkerFixtures>({
  viteServer: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      // 1) create the Vite server programmatically (reuses vite.config.ts, so
      //    root=src/web and the React plugin apply).
      const server = await createServer({
        configFile: VITE_CONFIG,
        server: { host: HOST, port: PORT, strictPort: true },
        logLevel: 'silent',
      });
      try {
        // 2) listen on 127.0.0.1:5173 with strictPort (from config above).
        await server.listen();
        // 3) hand the running server to the tests.
        await use(server);
      } finally {
        // 4) ALWAYS close, even if listen() or an assertion threw.
        await server.close();
      }
    },
    { scope: 'worker', auto: true },
  ],
});

export { expect };
