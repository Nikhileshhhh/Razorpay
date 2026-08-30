// Smoke check: prove the BUILT API artifact (dist/api/server.js) can boot and
// serve /health, AND that it reads configuration from a `.env` file at its
// working directory. Exits 0 on success, 1 on failure.
//
// The API port and environment are supplied ONLY via a temporary `.env` (they
// are removed from the child's inherited env), so a successful /health response
// carrying the .env-provided environment proves dotenv loading end to end.
//
// SECRET SAFETY: raw child stdout/stderr is NEVER printed. On failure we emit
// only safe metadata (reason code, exit code, signal, non-empty flags, elapsed)
// via buildSafeFailureReport, so a secret captured from the child can never be
// re-emitted by the failure handler.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSafeFailureReport } from './lib/safe-diagnostics.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const builtApi = join(repoRoot, 'dist', 'api', 'server.js');

const HOST = '127.0.0.1';
const PORT = 4700 + Math.floor(Math.random() * 200);
// Unmistakable non-credential marker; must never surface in emitted output.
const DECOY_SECRET_MARKER = 'TEST_ONLY_WEBHOOK_SECRET_MARKER';

const startedAt = Date.now();
let tempDir;
let child;
let stdout = '';
let stderr = '';

function cleanup() {
  if (child) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
  if (tempDir) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
// Clean up temp files and child on any exit path.
process.on('exit', cleanup);

function fail(reasonCode) {
  const report = buildSafeFailureReport({
    reasonCode,
    exitCode: child ? child.exitCode : null,
    signal: child ? child.signalCode : null,
    stdout,
    stderr,
    elapsedMs: Date.now() - startedAt,
  });
  console.error(`[smoke:api] FAIL: ${report}`);
  process.exit(1);
}

function succeed() {
  console.log(
    `[smoke:api] OK: built API booted on port ${PORT} (from .env) and served /health with environment=demo.`,
  );
  process.exit(0);
}

if (!existsSync(builtApi)) {
  console.error('[smoke:api] FAIL: reason=MISSING_BUILD_ARTIFACT (run "npm run build" first)');
  process.exit(1);
}

tempDir = mkdtempSync(join(tmpdir(), 'moneytrace-smoke-api-'));
writeFileSync(
  join(tempDir, '.env'),
  [
    'MONEYTRACE_ENV=demo',
    `API_PORT=${PORT}`,
    `API_HOST=${HOST}`,
    'LOG_LEVEL=silent',
    `RAZORPAY_WEBHOOK_SECRET=${DECOY_SECRET_MARKER}`,
    '',
  ].join('\n'),
);

// Child env WITHOUT the keys the .env file must supply, so a correct /health
// response proves the .env file (not inherited env) was the source.
const childEnv = { ...process.env };
delete childEnv.MONEYTRACE_ENV;
delete childEnv.API_PORT;
delete childEnv.API_HOST;
delete childEnv.LOG_LEVEL;

child = spawn(process.execPath, [builtApi], {
  cwd: tempDir,
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => (stdout += d.toString()));
child.stderr.on('data', (d) => (stderr += d.toString()));

async function poll() {
  const url = `http://${HOST}:${PORT}/health`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return fail('API_EXITED_EARLY');
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = await res.json();
        if (body.status !== 'ok') return fail('UNEXPECTED_HEALTH_STATUS');
        if (body.environment !== 'demo') return fail('ENVIRONMENT_NOT_FROM_DOTENV');
        // Detect (but never print) the decoy secret in captured output.
        if (stdout.includes(DECOY_SECRET_MARKER) || stderr.includes(DECOY_SECRET_MARKER)) {
          return fail('SECRET_IN_CHILD_OUTPUT');
        }
        return succeed();
      }
    } catch {
      /* server not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return fail('HEALTH_TIMEOUT');
}

poll().catch(() => fail('UNEXPECTED_SMOKE_ERROR'));
