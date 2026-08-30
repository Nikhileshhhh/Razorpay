#!/usr/bin/env tsx
// Minimal, transparent forward-migration runner.
//
// Applies every `db/migrations/*.sql` file, in lexical filename order, exactly
// once, tracked in a `schema_migrations` bookkeeping table. Each file runs
// inside its own transaction. This intentionally avoids drizzle-kit's
// snapshot/journal diffing so the SQL DDL (constraints, triggers, partial
// unique indexes) has full fidelity and is easy to review and test
// ("migrate from empty" / "reset twice" — backend PRD §19.2).
//
// Usage: tsx scripts/db/migrate.ts [--database-url=postgres://...]

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(repoRoot, 'db', 'migrations');

export interface MigrationResult {
  readonly file: string;
  readonly status: 'applied' | 'already_applied';
}

function resolveDatabaseUrl(): string {
  const arg = process.argv.find((a) => a.startsWith('--database-url='));
  if (arg) return arg.slice('--database-url='.length);
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error('DATABASE_URL is required (env var or --database-url=...)');
}

export async function runMigrations(databaseUrl: string): Promise<MigrationResult[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())`,
    );
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const appliedResult = await client.query<{ id: string }>('select id from schema_migrations');
    const applied = new Set(appliedResult.rows.map((r) => r.id));

    const results: MigrationResult[] = [];
    for (const file of files) {
      if (applied.has(file)) {
        results.push({ file, status: 'already_applied' });
        continue;
      }
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (id) values ($1)', [file]);
        await client.query('commit');
        results.push({ file, status: 'applied' });
      } catch (error) {
        await client.query('rollback');
        throw new Error(`migration ${file} failed`, { cause: error });
      }
    }
    return results;
  } finally {
    await client.end();
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runMigrations(resolveDatabaseUrl())
    .then((results) => {
      for (const r of results) console.log(`[migrate] ${r.status}: ${r.file}`);
      console.log(
        `[migrate] done (${results.filter((r) => r.status === 'applied').length} applied, ${results.length} total)`,
      );
    })
    .catch(() => {
      console.error('[migrate] FAILED: reason=migration_error');
      process.exit(1);
    });
}
