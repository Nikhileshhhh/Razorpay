import {
  pgTable,
  text,
  timestamp,
  bigint,
  jsonb,
  integer,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Audit/demo tables (backend PRD §8 "Audit/demo", §16, §18). */
export const auditEntries = pgTable(
  'audit_entries',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    auditSequence: bigint('audit_sequence', { mode: 'bigint' })
      .notNull()
      .default(sql`nextval('moneytrace_audit_sequence')`),
    artifactType: text('artifact_type').notNull(),
    artifactId: text('artifact_id').notNull(),
    artifactHash: text('artifact_hash'),
    actorId: text('actor_id'),
    actorRole: text('actor_role'),
    modelId: text('model_id'),
    promptVersion: text('prompt_version'),
    evidenceSetHash: text('evidence_set_hash'),
    policyBundleVersion: text('policy_bundle_version'),
    details: jsonb('details').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('audit_entries_seq_uq').on(t.tenantId, t.auditSequence),
    index('audit_entries_tenant_time_idx').on(t.tenantId, t.createdAt),
  ],
);

export const demoScenarioState = pgTable(
  'demo_scenario_state',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    scenarioId: text('scenario_id').notNull(),
    currentStep: integer('current_step').notNull().default(0),
    version: integer('version').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('demo_scenario_state_uq').on(t.tenantId, t.scenarioId)],
);

export const demoSeedManifest = pgTable('demo_seed_manifest', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  seedId: text('seed_id').notNull(),
  manifestHash: text('manifest_hash').notNull(),
  metrics: jsonb('metrics').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
