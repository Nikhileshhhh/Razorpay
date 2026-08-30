import {
  pgTable,
  text,
  timestamp,
  bigint,
  jsonb,
  integer,
  numeric,
  boolean,
  index,
  unique,
} from 'drizzle-orm/pg-core';

/** Cases tables (backend PRD §8 "Cases", §10.2). */
export const cases = pgTable(
  'cases',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    caseDedupeKey: text('case_dedupe_key').notNull(),
    epoch: integer('epoch').notNull().default(0),
    subjectId: text('subject_id').notNull(),
    expectationId: text('expectation_id').notNull(),
    controlId: text('control_id').notNull(),
    lifecycleState: text('lifecycle_state').notNull(),
    exposureAmountMinor: bigint('exposure_amount_minor', { mode: 'bigint' }).notNull().default(0n),
    currency: text('currency').notNull().default('INR'),
    priorityScore: numeric('priority_score').notNull().default('0'),
    evidenceCoverage: text('evidence_coverage').notNull().default('insufficient'),
    contradictionCount: integer('contradiction_count').notNull().default(0),
    ownerId: text('owner_id'),
    version: integer('version').notNull().default(0),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    isActiveEpoch: boolean('is_active_epoch').notNull().default(true),
  },
  (t) => [
    index('cases_state_idx').on(t.tenantId, t.lifecycleState),
    index('cases_exposure_idx').on(t.tenantId, t.exposureAmountMinor),
    index('cases_due_idx').on(t.tenantId, t.dueAt),
  ],
);

export const caseTransitions = pgTable(
  'case_transitions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    fromState: text('from_state'),
    toState: text('to_state').notNull(),
    reason: text('reason').notNull(),
    evidenceIds: jsonb('evidence_ids').notNull().default([]),
    actorId: text('actor_id'),
    expectedVersion: integer('expected_version').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('case_transitions_case_time_idx').on(t.caseId, t.occurredAt)],
);

export const caseNotes = pgTable(
  'case_notes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    expectedCaseVersion: integer('expected_case_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('case_notes_case_idx').on(t.caseId, t.createdAt)],
);

export const caseRelationships = pgTable(
  'case_relationships',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    sourceCaseId: text('source_case_id').notNull(),
    targetCaseId: text('target_case_id').notNull(),
    relationshipType: text('relationship_type').notNull(),
    reason: text('reason').notNull(),
    actorId: text('actor_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('case_relationships_uq').on(
      t.tenantId,
      t.sourceCaseId,
      t.targetCaseId,
      t.relationshipType,
    ),
    index('case_relationships_source_idx').on(t.tenantId, t.sourceCaseId, t.createdAt),
  ],
);
