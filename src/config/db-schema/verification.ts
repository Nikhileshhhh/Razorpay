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

/** Verification tables (backend PRD §8 "Verification", §13). */
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
    isCurrent: boolean('is_current').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('verification_runs_version_uq').on(t.tenantId, t.actionId, t.version)],
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
  ],
);
