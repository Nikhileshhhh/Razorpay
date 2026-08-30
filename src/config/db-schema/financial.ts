import {
  pgTable,
  text,
  timestamp,
  bigint,
  jsonb,
  integer,
  boolean,
  unique,
} from 'drizzle-orm/pg-core';

/** Financial state tables (backend PRD §8, §7, §10.1). */
export const economicSubjects = pgTable(
  'economic_subjects',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectKey: text('subject_key').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull().default('INR'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    terminalState: text('terminal_state'),
  },
  (t) => [unique('economic_subjects_uq').on(t.tenantId, t.subjectType, t.subjectKey)],
);

export const expectations = pgTable(
  'expectations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    subjectId: text('subject_id').notNull(),
    version: integer('version').notNull(),
    ruleId: text('rule_id').notNull(),
    ruleVersion: text('rule_version').notNull(),
    expectedAmountMinor: bigint('expected_amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull().default('INR'),
    expectedTerminalState: text('expected_terminal_state').notNull(),
    expectedBy: timestamp('expected_by', { withTimezone: true }),
    materialityClass: text('materiality_class').notNull().default('material'),
    inputEvidenceSetHash: text('input_evidence_set_hash'),
    isCurrent: boolean('is_current').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('expectations_version_uq').on(t.tenantId, t.subjectId, t.version)],
);

export const expectationInputs = pgTable(
  'expectation_inputs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    expectationId: text('expectation_id').notNull(),
    evidenceId: text('evidence_id').notNull(),
    inputRole: text('input_role').notNull(),
  },
  (t) => [unique('expectation_inputs_uq').on(t.expectationId, t.evidenceId, t.inputRole)],
);

export const invariantEvaluations = pgTable(
  'invariant_evaluations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    controlId: text('control_id').notNull(),
    controlVersion: text('control_version').notNull(),
    subjectId: text('subject_id').notNull(),
    evaluationWindow: text('evaluation_window').notNull(),
    inputHash: text('input_hash').notNull(),
    result: text('result').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }),
    currency: text('currency'),
    evidenceIds: jsonb('evidence_ids').notNull().default([]),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull().defaultNow(),
    evaluationVersion: integer('evaluation_version').notNull().default(1),
  },
  (t) => [
    unique('invariant_evaluations_uq').on(
      t.tenantId,
      t.controlId,
      t.controlVersion,
      t.subjectId,
      t.evaluationWindow,
      t.evaluationVersion,
    ),
  ],
);

export const financialOutcomes = pgTable('financial_outcomes', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  expectationId: text('expectation_id').notNull(),
  status: text('status').notNull(),
  version: integer('version').notNull().default(0),
  observedAmountMinor: bigint('observed_amount_minor', { mode: 'bigint' }),
  currency: text('currency'),
  isCurrent: boolean('is_current').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
