import {
  pgTable,
  text,
  timestamp,
  bigint,
  jsonb,
  integer,
  unique,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Agent-claim tables (backend PRD §8 "Claims", §13.3; ADR 0002 D2). */
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
    /** Canonical request hash for body-conflict idempotency (added in 0004). */
    requestHash: text('request_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('agent_result_claims_uq').on(t.tenantId, t.externalAgentId, t.externalClaimId)],
);

/** Append-only evidence attribution for an untrusted agent claim. */
export const agentClaimEvidenceBindings = pgTable(
  'agent_claim_evidence_bindings',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    claimId: text('claim_id').notNull(),
    ingestEventId: text('ingest_event_id').notNull(),
    evidenceType: text('evidence_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('agent_claim_evidence_bindings_claim_event_uq').on(
      t.tenantId,
      t.claimId,
      t.ingestEventId,
    ),
    uniqueIndex('agent_claim_capture_attribution_uq')
      .on(t.tenantId, t.ingestEventId)
      .where(sql`${t.evidenceType} = 'captured_payment'`),
    index('agent_claim_evidence_bindings_claim_idx').on(t.tenantId, t.claimId),
  ],
);

/**
 * Append-only claim evaluation history (ADR 0002 D2). `is_current` was removed in
 * migration 0004; the current pointer lives in {@link claimEvaluationHeads}.
 */
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('claim_evaluations_uq').on(t.claimId, t.evaluationVersion),
    unique('claim_evaluations_tenant_id_id_uq').on(t.tenantId, t.id),
  ],
);

/** Mutable current-head pointer: exactly one current evaluation per claim. */
export const claimEvaluationHeads = pgTable(
  'claim_evaluation_heads',
  {
    tenantId: text('tenant_id').notNull(),
    claimId: text('claim_id').notNull(),
    currentEvaluationId: text('current_evaluation_id').notNull(),
    status: text('status').notNull(),
    evaluationVersion: integer('evaluation_version').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.claimId] })],
);
