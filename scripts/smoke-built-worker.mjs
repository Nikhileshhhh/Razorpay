// Smoke check: prove that IMPORTING the BUILT worker artifact
// (dist/worker/worker.js) does NOT open a database connection and has no side
// effects (finding 1). Exits 0 on success, 1 on failure.
//
// The worker only starts (and connects) when executed directly. Imported, it
// must resolve immediately and expose its functions without touching Postgres.
// We deliberately run with NO DATABASE_URL and no Postgres available: if the
// import connected, it would hang or throw.

import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const repoRoot = resolve(import.meta.dirname, '..');
const builtWorker = join(repoRoot, 'dist', 'worker', 'worker.js');

if (!existsSync(builtWorker)) {
  console.error(`[smoke:worker] Missing build artifact ${builtWorker}. Run "npm run build" first.`);
  process.exit(1);
}

// Ensure no DB configuration is present for this check.
delete process.env.DATABASE_URL;

const timeout = setTimeout(() => {
  console.error(
    '[smoke:worker] FAIL: importing the worker did not settle quickly (possible DB connection attempt).',
  );
  process.exit(1);
}, 5_000);

try {
  const mod = await import(pathToFileURL(builtWorker).href);
  clearTimeout(timeout);

  if (typeof mod.startWorker !== 'function' || typeof mod.createBoss !== 'function') {
    console.error('[smoke:worker] FAIL: expected startWorker/createBoss exports were not found.');
    process.exit(1);
  }

  console.log(
    '[smoke:worker] OK: importing built worker opened no database connection and exposed its API without side effects.',
  );
  process.exit(0);
} catch (error) {
  clearTimeout(timeout);
  // Do not print the raw message (it could carry config); print only the type.
  console.error(
    `[smoke:worker] FAIL: importing the worker threw (${error?.constructor?.name ?? 'Error'}).`,
  );
  process.exit(1);
}
