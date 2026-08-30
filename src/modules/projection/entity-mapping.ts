import type { CanonicalEventType } from '../../contracts/events/event-types.js';

/**
 * Canonical event type -> projected entity type/business-state mapping.
 * Deterministic and total (every registered canonical event type maps to
 * exactly one entity type and business state) — unknown event types are
 * rejected upstream by the contract, so this mapping never needs a fallback.
 */
export interface EntityMapping {
  readonly entityType: string;
  readonly businessState: string;
  /** Which `entity_references` key identifies this entity, if any. */
  readonly referenceKey?: string;
}

const MAPPING: Record<CanonicalEventType, EntityMapping> = {
  OrderCreated: { entityType: 'order', businessState: 'created', referenceKey: 'order_id' },
  OrderPaid: { entityType: 'order', businessState: 'paid', referenceKey: 'order_id' },
  PaymentAuthorized: {
    entityType: 'payment',
    businessState: 'authorized',
    referenceKey: 'payment_id',
  },
  PaymentCaptured: { entityType: 'payment', businessState: 'captured', referenceKey: 'payment_id' },
  PaymentFailed: { entityType: 'payment', businessState: 'failed', referenceKey: 'payment_id' },
  RefundCreated: { entityType: 'refund', businessState: 'created', referenceKey: 'refund_id' },
  RefundProcessed: { entityType: 'refund', businessState: 'processed', referenceKey: 'refund_id' },
  RefundFailed: { entityType: 'refund', businessState: 'failed', referenceKey: 'refund_id' },
  TransferCreated: {
    entityType: 'transfer',
    businessState: 'created',
    referenceKey: 'transfer_id',
  },
  TransferProcessed: {
    entityType: 'transfer',
    businessState: 'processed',
    referenceKey: 'transfer_id',
  },
  SettlementCreated: {
    entityType: 'settlement',
    businessState: 'created',
    referenceKey: 'settlement_id',
  },
  SettlementProcessed: {
    entityType: 'settlement',
    businessState: 'processed',
    referenceKey: 'settlement_id',
  },
  SettlementObserved: {
    entityType: 'settlement',
    businessState: 'observed',
    referenceKey: 'settlement_id',
  },
  BankCreditObserved: {
    entityType: 'bank_credit',
    businessState: 'observed',
    referenceKey: 'bank_credit_id',
  },
  SellerReceivableOpened: {
    entityType: 'receivable',
    businessState: 'open',
    referenceKey: 'receivable_id',
  },
  SellerReceivableClosed: {
    entityType: 'receivable',
    businessState: 'closed',
    referenceKey: 'receivable_id',
  },
  RecoveryScheduled: {
    entityType: 'recovery',
    businessState: 'scheduled',
    referenceKey: 'recovery_id',
  },
  RecoverySuppressed: {
    entityType: 'recovery',
    businessState: 'suppressed',
    referenceKey: 'recovery_id',
  },
  AgentResultClaimed: {
    entityType: 'agent_claim',
    businessState: 'claimed',
    referenceKey: 'agent_claim_id',
  },
  SyntheticTransferFailed: {
    entityType: 'transfer',
    businessState: 'failed',
    referenceKey: 'transfer_id',
  },
};

export function mappingFor(eventType: CanonicalEventType): EntityMapping {
  return MAPPING[eventType];
}

/**
 * Explicit business-state precedence used only when source versions do not
 * decide ordering. Higher values are later/more authoritative states for the
 * same projected entity type. Keeping this table closed prevents ingestion
 * order from becoming accidental business authority.
 *
 * `transfer.failed` is deliberately ranked ABOVE `transfer.processed`
 * (backend PRD "known semantic risks" §1): `SyntheticTransferFailed` models an
 * authoritative reversal/failure DISCOVERED AFTER a transfer was processed —
 * the documented synthetic scenario is `TransferProcessed` then, later,
 * `SyntheticTransferFailed` invalidating it so CTRL-01/CTRL-02 can re-fire.
 * This differs from `payment`/`refund`, where a stray out-of-order `failed`
 * notification for an already-`captured`/`processed` id is treated as stale,
 * not a later reversal — there is no documented synthetic "payment reversal"
 * event distinct from a dispute/refund, which are separate entity types.
 */
const STATE_PRECEDENCE: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  order: { created: 10, paid: 20 },
  payment: { authorized: 10, failed: 20, captured: 30 },
  refund: { created: 10, failed: 20, processed: 30 },
  transfer: { created: 10, processed: 20, failed: 30 },
  settlement: { created: 10, processed: 20, observed: 30 },
  bank_credit: { observed: 10 },
  receivable: { open: 10, closed: 20 },
  recovery: { scheduled: 10, suppressed: 20 },
  agent_claim: { claimed: 10 },
};

export function statePrecedence(entityType: string, businessState: string): number {
  const value = STATE_PRECEDENCE[entityType]?.[businessState];
  if (value == null) throw new Error('unregistered projected business state');
  return value;
}

/**
 * Entity types whose lifecycle can legitimately CYCLE (e.g. a receivable can
 * be opened, closed, and later reopened by a fresh authoritative event for
 * the same entity — backend PRD "known semantic risks": a later authoritative
 * receivable reopening must be able to re-violate CTRL-03 even though an
 * older close event exists). A static per-state precedence number cannot
 * express "this open event is later than that close event" for a cycling
 * entity, so these types skip the state-precedence check entirely and order
 * purely by event_time (after source-version, same as every other type).
 * Non-cyclic types (order/payment/refund/transfer/settlement/...) keep
 * state-precedence ahead of event_time deliberately: it is what lets a
 * stray out-of-order/late notification for an already-advanced entity stay
 * stale instead of regressing (see `STATE_PRECEDENCE` comment above), and
 * transfer's `failed > processed` ranking already covers its one documented
 * reversal case without needing to be treated as cyclic.
 *
 * `recovery` is cyclic for the same reason as `receivable`: a
 * `RecoveryScheduled` can be followed by `RecoverySuppressed`, and a LATER
 * authoritative `RecoveryScheduled` must be detectable as a genuine
 * reschedule (CTRL-04 must be able to re-violate), not permanently blocked
 * by a static precedence ranking `suppressed` above `scheduled`.
 */
const CYCLIC_ENTITY_TYPES: ReadonlySet<string> = new Set(['receivable', 'recovery']);

export function isCyclicEntityType(entityType: string): boolean {
  return CYCLIC_ENTITY_TYPES.has(entityType);
}

export interface EntityIdentity {
  readonly entityKey: string;
  readonly sourceEntityId: string;
}

/**
 * Resolve the projected entity key/source-entity-id. Falls back to the
 * economic-subject hint (never silently dropping an event that lacks its
 * "natural" id field) so every accepted event always projects to SOME entity.
 */
export function resolveEntityIdentity(
  mapping: EntityMapping,
  entityReferences: Readonly<Record<string, string | null | undefined>>,
  economicSubjectHint: string | null,
): EntityIdentity {
  const referenced = mapping.referenceKey ? entityReferences[mapping.referenceKey] : null;
  const sourceEntityId = referenced ?? economicSubjectHint ?? 'unresolved';
  return { entityKey: `${mapping.entityType}:${sourceEntityId}`, sourceEntityId };
}
