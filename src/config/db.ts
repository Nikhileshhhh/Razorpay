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
/** Transaction handle accepted by helpers that must participate in a caller's unit of work. */
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Read/write query surface shared by the root database and an active transaction. */
export type DbExecutor = Database | DatabaseTransaction;

let pool: Pool | undefined;
let db: Database | undefined;

export function getPool(databaseUrl: string): Pool {
  if (!pool) {
    // Keep the API/worker pool bounded so the two processes plus pg-boss fit
    // within small hosted PostgreSQL session-pool limits (Supabase free tier: 15).
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
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
