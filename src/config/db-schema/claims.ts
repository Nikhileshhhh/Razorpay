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

/** Agent-claim tables (backend PRD §8 "Claims", §13.3). */
export const agentResultClaims = pgTable(
  'agent_result_claims',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    externalAgentId: text('external_agent_id').notNull(),
    externalClaimId: text('external_claim_id').notNull(),
    economicSubjectKey: text('economic_subject_key').notNull(),
    claimedAmountMinor: bigint('claimed_amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull().default('INR'),
    resultType: text('result_type').notNull(),
    attributionMethod: text('attribution_method').notNull(),
    correlationId: text('correlation_id'),
    claimTime: timestamp('claim_time', { withTimezone: true }).notNull(),
    evidenceTime: timestamp('evidence_time', { withTimezone: true }),
    evidenceRefs: jsonb('evidence_refs').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('agent_result_claims_uq').on(t.tenantId, t.externalAgentId, t.externalClaimId)],
);

export const claimEvaluations = pgTable(
  'claim_evaluations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    claimId: text('claim_id').notNull(),
    evaluationVersion: integer('evaluation_version').notNull(),
    status: text('status').notNull(),
    verifiedAmountMinor: bigint('verified_amount_minor', { mode: 'bigint' }),
    currency: text('currency'),
    isCurrent: boolean('is_current').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('claim_evaluations_uq').on(t.claimId, t.evaluationVersion)],
);
