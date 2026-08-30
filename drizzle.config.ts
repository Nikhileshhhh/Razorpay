import { defineConfig } from 'drizzle-kit';

// Drizzle configuration. Migrations are hand-written forward SQL under
// db/migrations/ (see scripts/db/migrate.mjs) for full DDL fidelity
// (constraints, partial unique indexes, append-only triggers); this config
// exists so `drizzle-kit studio` / introspection tooling can still find the
// typed schema definitions used by the application's repositories.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/config/db-schema.ts',
  out: './db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/moneytrace',
  },
});
