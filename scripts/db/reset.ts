#!/usr/bin/env tsx
import { loadDotenv } from '../../src/config/dotenv.js';
import { loadEnv } from '../../src/config/env.js';
import { getDb, getPool, closeDb } from '../../src/config/db.js';
import { resetDemoDatabase } from '../../src/modules/demo/reset.js';

loadDotenv();
const env = loadEnv();
if (!env.DATABASE_URL) {
  console.error('[reset] DATABASE_URL is required');
  process.exit(1);
}

const db = getDb(env.DATABASE_URL);
const pool = getPool(env.DATABASE_URL);
resetDemoDatabase(pool, db, env.MONEYTRACE_ENV)
  .then((result) => {
    console.log(`[reset] done. seed_id=${result.seedId} manifest_hash=${result.manifestHash}`);
  })
  .catch(() => {
    console.error('[reset] FAILED: reason=reset_error');
    process.exitCode = 1;
  })
  .finally(() => closeDb());
