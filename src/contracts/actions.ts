import { z } from 'zod';
import { boundedString, LIMITS } from './common/limits.js';
import { ActionId, CaseId, PlanId, Sha256Hash } from './common/identifiers.js';
import { Rfc3339Utc } from './common/timestamps.js';
import { SchemaVersion } from './common/versions.js';
import { ToolActionId } from './plans.js';

/**
 * Action reservation/execution record (handoff §9.3, PRD §17.12).
 *
 * `OUTCOME_UNKNOWN` is a first-class status DISTINCT from `FAILED`: an unknown
 * outcome must never be blindly retried with a new idempotency key (that logic
 * is MT-015). Only registered typed tools execute — `tool_id` is a `ToolActionId`.
 */
export const ActionStatus = z.enum([
  'AUTHORIZED',
  'RESERVED',
  'DISPATCHING',
  'ACKNOWLEDGED',
  'OUTCOME_UNKNOWN',
  'FAILED',
  'VERIFICATION_PENDING',
]);
export type ActionStatus = z.infer<typeof ActionStatus>;

/**
 * Terminal dispatch outcome, a strict enum (never a free-form string). `null`
 * before dispatch. `OUTCOME_UNKNOWN` is deliberately distinct from `FAILED`.
 */
export const ActionOutcome = z.enum(['ACKNOWLEDGED', 'FAILED', 'OUTCOME_UNKNOWN']);
export type ActionOutcome = z.infer<typeof ActionOutcome>;

const actionRecordBase = {
  schema_version: SchemaVersion,
  action_id: ActionId,
  case_id: CaseId,
  plan_id: PlanId,
  tool_id: ToolActionId,
  tool_version: boundedString(LIMITS.CODE_MAX),
  idempotency_key: boundedString(LIMITS.SHORT_TEXT),
  request_hash: Sha256Hash,
};

const undispatchedAction = (status: 'AUTHORIZED' | 'RESERVED') =>
  z
    .object({
      ...actionRecordBase,
      status: z.literal(status),
      attempt_count: z.literal(0),
      external_reference: z.null(),
      submitted_at: z.null(),
      acknowledged_at: z.null(),
      outcome_status: z.null(),
    })
    .strict();

const DispatchingAction = z
  .object({
    ...actionRecordBase,
    status: z.literal('DISPATCHING'),
    attempt_count: z.number().int().positive(),
    external_reference: boundedString(LIMITS.SHORT_TEXT).nullable(),
    submitted_at: Rfc3339Utc,
    acknowledged_at: z.null(),
    outcome_status: z.null(),
  })
  .strict();

const AcknowledgedAction = z
  .object({
    ...actionRecordBase,
    status: z.literal('ACKNOWLEDGED'),
    attempt_count: z.number().int().positive(),
    external_reference: boundedString(LIMITS.SHORT_TEXT).nullable(),
    submitted_at: Rfc3339Utc,
    acknowledged_at: Rfc3339Utc,
    outcome_status: z.literal('ACKNOWLEDGED'),
  })
  .strict();

const UnknownOutcomeAction = z
  .object({
    ...actionRecordBase,
    status: z.literal('OUTCOME_UNKNOWN'),
    attempt_count: z.number().int().positive(),
    external_reference: boundedString(LIMITS.SHORT_TEXT).nullable(),
    submitted_at: Rfc3339Utc,
    acknowledged_at: Rfc3339Utc.nullable(),
    outcome_status: z.literal('OUTCOME_UNKNOWN'),
  })
  .strict();

const FailedAction = z
  .object({
    ...actionRecordBase,
    status: z.literal('FAILED'),
    attempt_count: z.number().int().positive(),
    external_reference: boundedString(LIMITS.SHORT_TEXT).nullable(),
    submitted_at: Rfc3339Utc.nullable(),
    acknowledged_at: Rfc3339Utc.nullable(),
    outcome_status: z.literal('FAILED'),
  })
  .strict();

const VerificationPendingAction = z
  .object({
    ...actionRecordBase,
    status: z.literal('VERIFICATION_PENDING'),
    attempt_count: z.number().int().positive(),
    external_reference: boundedString(LIMITS.SHORT_TEXT).nullable(),
    submitted_at: Rfc3339Utc,
    acknowledged_at: Rfc3339Utc.nullable(),
    outcome_status: z.enum(['ACKNOWLEDGED', 'OUTCOME_UNKNOWN']),
  })
  .strict();

export const ActionRecord = z.discriminatedUnion('status', [
  undispatchedAction('AUTHORIZED'),
  undispatchedAction('RESERVED'),
  DispatchingAction,
  AcknowledgedAction,
  UnknownOutcomeAction,
  FailedAction,
  VerificationPendingAction,
]);
export type ActionRecord = z.infer<typeof ActionRecord>;
