import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';
import PgBoss from 'pg-boss';
import { loadEnv, type Env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { toSafeError } from '../config/errors.js';
import { loadDotenv } from '../config/dotenv.js';
import { getDb } from '../config/db.js';
import { dispatchPendingOutbox } from './outbox-dispatcher.js';
import { registerB2JobHandlers } from './job-handlers.js';
import { registerB3JobHandlers } from './job-handlers-b3.js';

/**
 * Durable-jobs worker entry point.
 *
 * The worker is a separate process built from the same codebase (architecture
 * handoff §4). It uses pg-boss for durable jobs inside PostgreSQL. MT-001 keeps
 * this compile-safe and side-effect-free at import time: no queue and no
 * database connection is opened unless the worker is started explicitly (that
 * is, importing this module must not connect to PostgreSQL). Projectors, outbox
 * dispatch, and action jobs are added in later tasks.
 */
export function createBoss(env: Env): PgBoss {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to start the MoneyTrace worker.');
  }
  return new PgBoss({ connectionString: env.DATABASE_URL });
}

export async function startWorker(env: Env = loadEnv()): Promise<PgBoss> {
  const logger = createLogger({ level: env.LOG_LEVEL, name: 'moneytrace-worker' });
  const boss = createBoss(env);
  const db = getDb(env.DATABASE_URL!);
  boss.on('error', (error: unknown) => {
    // Never log the raw pg-boss/PostgreSQL error message; it may embed the
    // connection string (with password). Use a safe descriptor.
    logger.error({ msg: 'worker queue error', err: toSafeError(error, 'queue') });
  });
  await boss.start();
  await registerB2JobHandlers(boss, db);
  await registerB3JobHandlers(boss, db, env);
  await dispatchPendingOutbox(db, boss);
  const outboxTimer = setInterval(() => {
    void dispatchPendingOutbox(db, boss).catch(() => {
      logger.error({ msg: 'outbox dispatch failed', err: { kind: 'outbox_dispatch' } });
    });
  }, 500);
  outboxTimer.unref();
  boss.on('stopped', () => clearInterval(outboxTimer));
  logger.info({ msg: 'MoneyTrace worker started', environment: env.MONEYTRACE_ENV });
  return boss;
}

// Only start the worker when executed directly, not when imported (e.g. by tests
// or the import/no-side-effect smoke check).
const entry = argv[1];
const isDirectRun = typeof entry === 'string' && import.meta.url === pathToFileURL(entry).href;
if (isDirectRun) {
  // Load `.env` at the executable entry point only.
  loadDotenv();
  startWorker().catch((error: unknown) => {
    createLogger({ name: 'moneytrace-worker' }).fatal({
      msg: 'Worker failed to start',
      err: toSafeError(error, 'startup'),
    });
    process.exitCode = 1;
  });
}
