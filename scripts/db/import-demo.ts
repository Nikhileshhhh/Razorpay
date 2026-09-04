#!/usr/bin/env tsx
import { closeDb, getDb } from '../../src/config/db.js';
import { loadDotenv } from '../../src/config/dotenv.js';
import { loadEnv } from '../../src/config/env.js';
import { DEMO_SEED_ID, generateDemoDataset } from '../../src/modules/demo/dataset.js';
import { REGISTERED_DEMO_TENANT_ID } from '../../src/modules/demo/demo-tenant.js';
import { createTenantContext } from '../../src/modules/identity/tenant-context.js';

loadDotenv();
const env = loadEnv();
if (!env.DATABASE_URL) {
  console.error('[import-demo] DATABASE_URL is required');
  process.exit(1);
}

const db = getDb(env.DATABASE_URL);
generateDemoDataset(
  db,
  env,
  createTenantContext(REGISTERED_DEMO_TENANT_ID, env.MONEYTRACE_ENV),
  DEMO_SEED_ID,
  { concurrency: 8 },
)
  .then((result) => {
    console.log(
      `[import-demo] accepted records=${result.manifest.records_total} manifest_hash=${result.manifestHash}`,
    );
  })
  .catch(() => {
    console.error('[import-demo] FAILED: reason=dataset_import_error');
    process.exitCode = 1;
  })
  .finally(() => closeDb());
