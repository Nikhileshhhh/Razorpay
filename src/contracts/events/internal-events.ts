import { z } from 'zod';
import { CaseId, OpaqueId, TenantId } from '../common/identifiers.js';
import { Rfc3339Utc } from '../common/timestamps.js';
import { SchemaVersion } from '../common/versions.js';

/**
 * MoneyTrace internal lifecycle events (PRD §18.2). These are control-plane
 * events and are kept strictly SEPARATE from source/canonical financial events —
 * an internal control event is never source evidence.
 */
export const InternalEventType = z.enum([
  'evidence.accepted',
  'evidence.duplicate_detected',
  'evidence.conflicting_duplicate_quarantined',
  'entity.projected',
  'relationship.created',
  'relationship.candidate_created',
  'expectation.created',
  'invariant.violated',
  'case.opened',
  'case.updated',
  'investigation.requested',
  'investigation.completed',
  'plan.proposed',
  'policy.evaluated',
  'approval.requested',
  'approval.decided',
  'action.reserved',
  'action.submitted',
  'action.acknowledged',
  'verification.completed',
  'reconciliation.completed',
  'case.reconciled',
  'case.abstained',
]);
export type InternalEventType = z.infer<typeof InternalEventType>;

export const InternalEvent = z
  .object({
    schema_version: SchemaVersion,
    event_type: InternalEventType,
    tenant_id: TenantId,
    occurred_at: Rfc3339Utc,
    correlation_id: OpaqueId.nullish(),
    case_id: CaseId.nullish(),
  })
  .strict();
export type InternalEvent = z.infer<typeof InternalEvent>;
