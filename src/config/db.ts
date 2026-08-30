import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './db-schema.js';

/**
 * Lazy PostgreSQL / Drizzle access.
 *
 * PostgreSQL is the prototype's only durable infrastructure dependency. No
 * connection is opened at import time — a pool is created on first request, so
 * build/typecheck/unit tests run without a database. Migrations are applied by
 * `scripts/db/migrate.ts` (hand-written forward SQL), not by Drizzle's own
 * migrator; this module wires the same typed schema (`src/config/db-schema.ts`)
 * for query building in repositories.
 */
export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let db: Database | undefined;

export function getPool(databaseUrl: string): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl });
  }
  return pool;
}

export function getDb(databaseUrl: string): Database {
  if (!db) {
    db = drizzle(getPool(databaseUrl), { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    db = undefined;
  }
}
