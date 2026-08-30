import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../../scripts/db/migrate.js';

/**
 * Ephemeral PostgreSQL database per test file — proves "migrate from an empty
 * database" (backend PRD §19.2) for real, rather than asserting against
 * whatever state the shared dev database happens to be in.
 *
 * Requires `DATABASE_URL` to point at a reachable PostgreSQL server with
 * CREATEDB privilege (the local dev Postgres started for this project
 * satisfies this). If it is not set, these tests fail loudly rather than
 * silently skipping — a missing database is a real gap, not a pass.
 */
export interface TestDatabase {
  readonly databaseUrl: string;
  readonly databaseName: string;
  teardown(): Promise<void>;
}

function requireBaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is required for database integration tests (point it at a local PostgreSQL with CREATEDB privilege)',
    );
  }
  return url;
}

function withDatabaseName(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/** Create a fresh, migrated, ephemeral database. Caller must call `teardown()`. */
export async function createMigratedTestDatabase(): Promise<TestDatabase> {
  const baseUrl = requireBaseUrl();
  const adminUrl = withDatabaseName(baseUrl, 'postgres');
  const databaseName = `moneytrace_test_${randomUUID().replaceAll('-', '').slice(0, 16)}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`create database ${databaseName}`);
  } finally {
    await admin.end();
  }

  const databaseUrl = withDatabaseName(baseUrl, databaseName);
  await runMigrations(databaseUrl);

  return {
    databaseUrl,
    databaseName,
    async teardown() {
      const cleanupAdmin = new pg.Client({ connectionString: adminUrl });
      await cleanupAdmin.connect();
      try {
        // Terminate any lingering connections before dropping.
        await cleanupAdmin.query(
          `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
          [databaseName],
        );
        await cleanupAdmin.query(`drop database if exists ${databaseName}`);
      } finally {
        await cleanupAdmin.end();
      }
    },
  };
}
