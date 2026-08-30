import { z } from 'zod';
import { boundedString, LIMITS } from '../common/limits.js';
import {
  EconomicSubjectHint,
  EventId,
  OpaqueId,
  RawPayloadRef,
  Sha256Hash,
  TenantId,
} from '../common/identifiers.js';
import { MinorAmount, SupportedCurrency } from '../common/money.js';
import { Rfc3339Utc } from '../common/timestamps.js';
import { SchemaVersion } from '../common/versions.js';
import {
  requiredEnvironmentFor,
  type CanonicalEventType,
  type SourceSystem,
} from './event-types.js';
import { CANONICAL_EVENT_CLASSIFICATIONS } from './classification.js';
import { BankCreditObservedData, EmptyData, SettlementScopedData } from './payloads.js';

/**
 * Canonical event envelope (architecture §8.1).
 *
 * There is ONE authoritative `CanonicalEvent` schema, used identically for
 * runtime validation and OpenAPI generation (no weaker "OpenApiSchema" twin).
 * Every safety rule is STRUCTURAL — expressible as oneOf/allOf in OpenAPI 3.0.3:
 *   1. amount_minor and currency are present together or both absent/null
 *      (an `allOf` money-presence oneOf);
 *   2. event_type is bound to its allowed source_system values, and each
 *      source_system is bound to its required metadata.environment
 *      (RAZORPAY_TEST -> test, SYNTHETIC_* -> synthetic), generated from the
 *      executable classification registry (single source of truth);
 *   3. BankCreditObserved allows only SYNTHETIC_BANK; SyntheticTransferFailed
 *      only SYNTHETIC_ROUTE; `live` is not advertised in schema 1.0.
 * `source_event_type` is preserved as a bounded raw string.
 */

/** Strict, documented-only entity reference map (no arbitrary keys). */
export const EntityReferences = z
  .object({
    order_id: OpaqueId.nullish(),
    payment_id: OpaqueId.nullish(),
    refund_id: OpaqueId.nullish(),
    transfer_id: OpaqueId.nullish(),
    settlement_id: OpaqueId.nullish(),
    receivable_id: OpaqueId.nullish(),
    bank_credit_id: OpaqueId.nullish(),
    recipient_account_id: OpaqueId.nullish(),
    recovery_id: OpaqueId.nullish(),
    agent_claim_id: OpaqueId.nullish(),
    dispute_id: OpaqueId.nullish(),
  })
  .strict();
export type EntityReferences = z.infer<typeof EntityReferences>;

const commonFields = {
  event_id: EventId,
  tenant_id: TenantId,
  source_account_id: OpaqueId.nullish(),
  source_event_id: OpaqueId.nullish(),
  source_event_type: boundedString(LIMITS.ID_MAX),
  schema_version: SchemaVersion,
  event_time: Rfc3339Utc,
  ingested_at: Rfc3339Utc,
  source_entity_version: z.number().int().min(0).nullish(),
  entity_references: EntityReferences,
  economic_subject_hint: EconomicSubjectHint.nullish(),
  amount_minor: MinorAmount.nullish(),
  currency: SupportedCurrency.nullish(),
  correlation_id: OpaqueId.nullish(),
  causation_id: OpaqueId.nullish(),
  payload_hash: Sha256Hash,
  raw_payload_ref: RawPayloadRef,
};

type EventDataSchema =
  typeof BankCreditObservedData | typeof SettlementScopedData | typeof EmptyData;

function dataForEvent(eventType: CanonicalEventType): EventDataSchema {
  if (eventType === 'BankCreditObserved') return BankCreditObservedData;
  if (
    eventType === 'SettlementCreated' ||
    eventType === 'SettlementProcessed' ||
    eventType === 'SettlementObserved'
  ) {
    return SettlementScopedData;
  }
  return EmptyData;
}

/** One strict envelope variant for a specific (event_type, source_system). */
function eventSourceVariant(eventType: CanonicalEventType, source: SourceSystem) {
  return z
    .object({
      ...commonFields,
      source_system: z.literal(source),
      metadata: z.object({ environment: z.literal(requiredEnvironmentFor(source)) }).strict(),
      event_type: z.literal(eventType),
      data: dataForEvent(eventType),
    })
    .strict();
}

type EventSourceVariantSchema = ReturnType<typeof eventSourceVariant>;

const eventSourceVariants: EventSourceVariantSchema[] = [];
for (const cls of CANONICAL_EVENT_CLASSIFICATIONS) {
  for (const source of cls.allowed_source_systems) {
    eventSourceVariants.push(eventSourceVariant(cls.event_type, source));
  }
}
function atLeastTwoSchemas<T>(schemas: readonly T[]): [T, T, ...T[]] {
  const [first, second, ...rest] = schemas;
  if (first === undefined || second === undefined) {
    throw new Error('CanonicalEvent requires at least two registered event/source variants');
  }
  return [first, second, ...rest];
}

const eventSourceUnion = z.union(atLeastTwoSchemas(eventSourceVariants));

/** Structural amount/currency co-presence: both valid, or both null/absent. */
const moneyPresence = z.union([
  z.object({ amount_minor: MinorAmount, currency: SupportedCurrency }),
  z.object({ amount_minor: z.null().optional(), currency: z.null().optional() }),
]);

/** The single authoritative canonical event schema (runtime AND OpenAPI). */
export const CanonicalEvent = z.intersection(eventSourceUnion, moneyPresence);
export type CanonicalEvent = z.infer<typeof CanonicalEvent>;
