#!/usr/bin/env tsx
import { loadDotenv } from '../../src/config/dotenv.js';
import { loadEnv } from '../../src/config/env.js';
import { getDb, closeDb } from '../../src/config/db.js';
import { seedIdentity } from '../../src/modules/demo/seed-identity.js';
import { seedSourceConnections } from '../../src/modules/demo/seed-sources.js';
import { seedPolicyBundle } from '../../src/modules/policy/policy-bundle.js';
import { seedVerificationContracts } from '../../src/modules/verification/verification-contracts-seed.js';

loadDotenv();
const env = loadEnv();
if (!env.DATABASE_URL) {
  console.error('[seed] DATABASE_URL is required');
  process.exit(1);
}

const db = getDb(env.DATABASE_URL);
seedIdentity(db)
  .then(() => seedSourceConnections(db))
  .then(() => seedPolicyBundle(db))
  .then(() => seedVerificationContracts(db))
  .then(() => {
    console.log(
      '[seed] identity + policy bundle + verification contracts seeded (tenants, users, memberships, moneytrace_demo_v1)',
    );
  })
  .catch(() => {
    console.error('[seed] FAILED: reason=seed_error');
    process.exitCode = 1;
  })
  .finally(() => closeDb());
