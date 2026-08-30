import {
  pgTable,
  text,
  timestamp,
  bigint,
  jsonb,
  integer,
  unique,
  index,
  customType,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** Sources/evidence tables (backend PRD §8, §9). */
export const sourceConnections = pgTable(
  'source_connections',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    sourceSystem: text('source_system').notNull(),
    externalAccountId: text('external_account_id'),
    capabilityStatus: text('capability_status').notNull().default('available'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('source_connections_uq').on(t.tenantId, t.sourceSystem, t.externalAccountId)],
);

export const ingestEvents = pgTable(
  'ingest_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    sourceSystem: text('source_system').notNull(),
    sourceAccountId: text('source_account_id'),
    sourceEventId: text('source_event_id'),
    sourceEventType: text('source_event_type').notNull(),
    eventType: text('event_type'),
    sourceEntityVersion: integer('source_entity_version'),
    eventTime: timestamp('event_time', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    payloadHash: text('payload_hash').notNull(),
    rawPayload: jsonb('raw_payload').notNull(),
    rawBytes: bytea('raw_bytes').notNull(),
    rawRepresentation: text('raw_representation').notNull(),
    signatureStatus: text('signature_status').notNull(),
    dedupeStatus: text('dedupe_status').notNull(),
    quarantineStatus: text('quarantine_status').notNull().default('none'),
    fallbackDedupeKey: text('fallback_dedupe_key').notNull(),
    correlationId: text('correlation_id'),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }),
    currency: text('currency'),
    entityReferences: jsonb('entity_references').notNull().default({}),
    economicSubjectHint: text('economic_subject_hint'),
  },
  (t) => [
    index('ingest_events_tenant_time_idx').on(t.tenantId, t.eventTime),
    index('ingest_events_tenant_type_idx').on(t.tenantId, t.eventType),
  ],
);

export const eventConflicts = pgTable(
  'event_conflicts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    sourceSystem: text('source_system').notNull(),
    sourceEventId: text('source_event_id').notNull(),
    existingIngestEventId: text('existing_ingest_event_id').notNull(),
    existingHash: text('existing_hash').notNull(),
    newHash: text('new_hash').notNull(),
    newRawPayload: jsonb('new_raw_payload').notNull(),
    newRawBytes: bytea('new_raw_bytes').notNull(),
    rawRepresentation: text('raw_representation').notNull(),
    quarantineReason: text('quarantine_reason').notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('event_conflicts_tenant_idx').on(t.tenantId, t.sourceEventId)],
);

export const projectorRuns = pgTable(
  'projector_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectorName: text('projector_name').notNull(),
    projectorVersion: text('projector_version').notNull(),
    ingestEventId: text('ingest_event_id').notNull(),
    status: text('status').notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('projector_runs_uq').on(
      t.tenantId,
      t.projectorName,
      t.projectorVersion,
      t.ingestEventId,
    ),
  ],
);

export const entityRevisions = pgTable(
  'entity_revisions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityKey: text('entity_key').notNull(),
    sourceSystem: text('source_system').notNull(),
    sourceEntityId: text('source_entity_id').notNull(),
    revisionKey: text('revision_key').notNull(),
    sourceEntityVersion: integer('source_entity_version'),
    businessState: text('business_state').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }),
    currency: text('currency'),
    eventTime: timestamp('event_time', { withTimezone: true }).notNull(),
    ingestEventId: text('ingest_event_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('entity_revisions_uq').on(
      t.tenantId,
      t.sourceSystem,
      t.entityType,
      t.sourceEntityId,
      t.revisionKey,
    ),
    index('entity_revisions_entity_idx').on(t.tenantId, t.entityKey, t.eventTime),
  ],
);

export const entityCurrent = pgTable('entity_current', {
  tenantId: text('tenant_id').notNull(),
  entityKey: text('entity_key').notNull(),
  entityType: text('entity_type').notNull(),
  currentRevisionId: text('current_revision_id').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
