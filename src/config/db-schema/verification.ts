import {
  pgTable,
  text,
  timestamp,
  bigint,
  jsonb,
  integer,
  unique,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

/** Verification tables (backend PRD §8 "Verification", §13; ADR 0002 D2/D3). */
export const verificationContracts = pgTable(
  'verification_contracts',
  {
    id: text('id').primaryKey(),
    contractKey: text('contract_key').notNull(),
    version: text('version').notNull(),
    definition: jsonb('definition').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('verification_contracts_uq').on(t.contractKey, t.version)],
);

/**
 * Append-only verification history (ADR 0002 D2). Each material re-evaluation
 * appends a new version; the current pointer lives in {@link verificationRunHeads}.
 * `is_current` was removed in migration 0004 (it conflicted with the append-only
 * trigger).
 */
export const verificationRuns = pgTable(
  'verification_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    actionId: text('action_id').notNull(),
    contractKey: text('contract_key').notNull(),
    contractVersion: text('contract_version').notNull(),
    status: text('status').notNull(),
    evidenceIds: jsonb('evidence_ids').notNull().default([]),
    verifiedAmountMinor: bigint('verified_amount_minor', { mode: 'bigint' }),
    currency: text('currency'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('verification_runs_version_uq').on(t.tenantId, t.actionId, t.version),
    unique('verification_runs_tenant_id_id_uq').on(t.tenantId, t.id),
    index('verification_runs_action_idx').on(t.tenantId, t.actionId),
  ],
);

/** Mutable current-head pointer: exactly one current verification run per action. */
export const verificationRunHeads = pgTable(
  'verification_run_heads',
  {
    tenantId: text('tenant_id').notNull(),
    actionId: text('action_id').notNull(),
    currentRunId: text('current_run_id').notNull(),
    contractKey: text('contract_key').notNull(),
    contractVersion: text('contract_version').notNull(),
    status: text('status').notNull(),
    version: integer('version').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.actionId] })],
);

export const reconciliationAllocations = pgTable(
  'reconciliation_allocations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    expectationId: text('expectation_id').notNull(),
    bankLineEvidenceId: text('bank_line_evidence_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull().default('INR'),
    status: text('status').notNull().default('ALLOCATED'),
    closedReceivableId: text('closed_receivable_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('reconciliation_allocations_bank_line_uq').on(t.tenantId, t.bankLineEvidenceId),
    unique('reconciliation_allocations_expectation_uq').on(t.tenantId, t.expectationId),
    unique('reconciliation_allocations_tenant_id_id_uq').on(t.tenantId, t.id),
  ],
);

/**
 * Append-only receivable closure fact (ADR 0002 D3). One closure per allocation /
 * expectation / close action / closure evidence; the allocation row is never
 * mutated to record closure.
 */
export const receivableClosures = pgTable(
  'receivable_closures',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    allocationId: text('allocation_id').notNull(),
    expectationId: text('expectation_id').notNull(),
    caseId: text('case_id').notNull(),
    closeActionId: text('close_action_id').notNull(),
    closureEvidenceId: text('closure_evidence_id').notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('receivable_closures_allocation_uq').on(t.tenantId, t.allocationId),
    unique('receivable_closures_expectation_uq').on(t.tenantId, t.expectationId),
    unique('receivable_closures_action_uq').on(t.tenantId, t.closeActionId),
    unique('receivable_closures_evidence_uq').on(t.tenantId, t.closureEvidenceId),
  ],
);

/**
 * Append-only reconciliation reversal fact (ADR 0002 D3). One reversal per
 * allocation; authoritative reversal evidence is consumed once. The allocation
 * and closure rows are never mutated.
 */
export const reconciliationReversals = pgTable(
  'reconciliation_reversals',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    allocationId: text('allocation_id').notNull(),
    expectationId: text('expectation_id').notNull(),
    caseId: text('case_id').notNull(),
    reversalEvidenceId: text('reversal_evidence_id').notNull(),
    reversedAmountMinor: bigint('reversed_amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull().default('INR'),
    reversedAt: timestamp('reversed_at', { withTimezone: true }).notNull(),
    newCaseEpoch: integer('new_case_epoch'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('reconciliation_reversals_allocation_uq').on(t.tenantId, t.allocationId),
    unique('reconciliation_reversals_evidence_uq').on(t.tenantId, t.reversalEvidenceId),
  ],
);
