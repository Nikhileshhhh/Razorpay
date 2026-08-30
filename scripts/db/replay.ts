#!/usr/bin/env tsx
import { loadDotenv } from '../../src/config/dotenv.js';
import { isDemoLikeEnvironment, loadEnv } from '../../src/config/env.js';
import { closeDb, getDb } from '../../src/config/db.js';
import { createTenantContext } from '../../src/modules/identity/tenant-context.js';
import { replayTenantProjections } from '../../src/modules/projection/replay.js';

loadDotenv();
const env = loadEnv();
if (!env.DATABASE_URL || !isDemoLikeEnvironment(env.MONEYTRACE_ENV)) {
  console.error('[replay] FAILED: reason=environment_not_allowed');
  process.exit(1);
}
const db = getDb(env.DATABASE_URL);
replayTenantProjections(db, createTenantContext('ten_demo', env.MONEYTRACE_ENV))
  .then((result) => {
    if (!result.matchesShadow) throw new Error('projection replay manifest mismatch');
    console.log(`[replay] done events=${result.eventCount} manifest_hash=${result.manifestHash}`);
  })
  .catch(() => {
    console.error('[replay] FAILED: reason=replay_error');
    process.exitCode = 1;
  })
  .finally(() => closeDb());
