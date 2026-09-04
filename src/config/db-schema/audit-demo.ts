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
    // Gate B4 remediation: `currentStep` is bumped synchronously the instant
    // a step is durably queued; `completedStep` is written only by the
    // worker once it has actually applied that step, so callers can tell
    // queued from completed rather than inferring completion from the
    // request having returned 200.
    completedStep: integer('completed_step').notNull().default(0),
    lastError: text('last_error'),
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

/** Append-only import ledger (backend PRD §14.1 `POST /v1/imports`; ADR 0002 D9). */
export const dataImports = pgTable(
  'data_imports',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    source: text('source').notNull(),
    seedId: text('seed_id'),
    itemCount: integer('item_count').notNull(),
    acceptedCount: integer('accepted_count').notNull().default(0),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    conflictCount: integer('conflict_count').notNull().default(0),
    manifestHash: text('manifest_hash'),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('data_imports_tenant_id_id_uq').on(t.tenantId, t.id)],
);

/**
 * Append-only 500-record dataset ledger (ADR 0002 D9). Each row links one
 * imported source record to exactly one accepted, non-quarantined ingest event.
 */
export const demoDatasetRecords = pgTable(
  'demo_dataset_records',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    seedId: text('seed_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    importId: text('import_id').notNull(),
    sourceSystem: text('source_system').notNull(),
    sourceEventId: text('source_event_id').notNull(),
    economicSubjectKey: text('economic_subject_key').notNull(),
    ingestEventId: text('ingest_event_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('demo_dataset_records_ordinal_uq').on(t.tenantId, t.seedId, t.ordinal),
    unique('demo_dataset_records_ingest_uq').on(t.tenantId, t.ingestEventId),
    index('demo_dataset_records_seed_idx').on(t.tenantId, t.seedId),
  ],
);

/** Mutable, global worker heartbeat for `/ready` (no tenant data, no secret). */
export const workerHeartbeat = pgTable('worker_heartbeat', {
  id: text('id').primaryKey(),
  lastBeatAt: timestamp('last_beat_at', { withTimezone: true }).notNull().defaultNow(),
  status: text('status').notNull().default('up'),
});
