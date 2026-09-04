import {
  pgTable,
  text,
  timestamp,
  bigint,
  jsonb,
  integer,
  boolean,
  unique,
  index,
} from 'drizzle-orm/pg-core';

/** Control-loop tables (backend PRD §8 "Control loop", §12). */
export const plans = pgTable(
  'plans',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    templateId: text('template_id').notNull(),
    version: integer('version').notNull().default(1),
    parameters: jsonb('parameters').notNull(),
    planHash: text('plan_hash').notNull(),
    authorityLevel: text('authority_level').notNull(),
    maximumAmountImpactMinor: bigint('maximum_amount_impact_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull().default('INR'),
    status: text('status').notNull(),
    isCurrent: boolean('is_current').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('plans_hash_uq').on(t.tenantId, t.planHash)],
);

export const policyBundles = pgTable('policy_bundles', {
  id: text('id').primaryKey(),
  version: text('version').notNull().unique(),
  rules: jsonb('rules').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const policyDecisions = pgTable(
  'policy_decisions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    planId: text('plan_id').notNull(),
    policyBundleVersion: text('policy_bundle_version').notNull(),
    decision: text('decision').notNull(),
    matchedRules: jsonb('matched_rules').notNull().default([]),
    requiredRole: text('required_role'),
    reasonCodes: jsonb('reason_codes').notNull().default([]),
    inputHash: text('input_hash').notNull(),
    actorId: text('actor_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('policy_decisions_case_idx').on(t.caseId, t.createdAt)],
);

export const approvals = pgTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    planId: text('plan_id').notNull(),
    decisionBasisHash: text('decision_basis_hash').notNull(),
    decisionBasis: jsonb('decision_basis').notNull(),
    requiredRole: text('required_role').notNull(),
    requesterId: text('requester_id').notNull(),
    approverId: text('approver_id'),
    decision: text('decision'),
    reason: text('reason'),
    state: text('state').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [index('approvals_case_idx').on(t.caseId, t.requestedAt)],
);

export const actions = pgTable(
  'actions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    planId: text('plan_id').notNull(),
    toolId: text('tool_id').notNull(),
    toolVersion: text('tool_version').notNull().default('v1'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    externalReference: text('external_reference'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    outcomeStatus: text('outcome_status'),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('actions_idempotency_uq').on(t.tenantId, t.idempotencyKey)],
);

export const actionAttempts = pgTable(
  'action_attempts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    actionId: text('action_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    requestPayload: jsonb('request_payload').notNull(),
    responsePayload: jsonb('response_payload'),
    errorClass: text('error_class'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('action_attempts_uq').on(t.actionId, t.attemptNumber)],
);

export const outbox = pgTable(
  'outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    topic: text('topic').notNull(),
    domainEventId: text('domain_event_id').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    claimAttempts: integer('claim_attempts').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('outbox_topic_event_uq').on(t.topic, t.domainEventId),
    index('outbox_status_idx').on(t.status, t.createdAt),
  ],
);
