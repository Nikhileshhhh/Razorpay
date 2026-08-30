import { z } from 'zod';

/**
 * Canonical MoneyTrace event-type enum and source enums.
 *
 * `CanonicalEventType` is a strict MoneyTrace enum — NOT the raw upstream string
 * (that is `source_event_type`, a preserved bounded string). The 19 registered
 * financial events are from architecture §8.2; `SyntheticTransferFailed` is a
 * synthetic-only canonical event (handoff §8.2 note) and is never a Razorpay
 * fact — see events/classification.ts.
 */
export const CanonicalEventType = z.enum([
  'OrderCreated',
  'OrderPaid',
  'PaymentAuthorized',
  'PaymentCaptured',
  'PaymentFailed',
  'RefundCreated',
  'RefundProcessed',
  'RefundFailed',
  'TransferCreated',
  'TransferProcessed',
  'SettlementCreated',
  'SettlementProcessed',
  'SettlementObserved',
  'BankCreditObserved',
  'SellerReceivableOpened',
  'SellerReceivableClosed',
  'RecoveryScheduled',
  'RecoverySuppressed',
  'AgentResultClaimed',
  'SyntheticTransferFailed',
]);
export type CanonicalEventType = z.infer<typeof CanonicalEventType>;

/**
 * Source systems that can produce evidence/events (handoff §2.7 / §8.1).
 *
 * `SYNTHETIC_RAZORPAY_FIXTURE` is the explicitly-labelled signed Razorpay-SHAPED
 * synthetic fallback the architecture (§2.7) requires — it is unmistakably
 * synthetic and must NEVER be presented as real `RAZORPAY_TEST` evidence. There
 * is deliberately no `RAZORPAY_LIVE` source in the Buildathon schema.
 */
export const SourceSystem = z.enum([
  'RAZORPAY_TEST',
  'SYNTHETIC_RAZORPAY_FIXTURE',
  'SYNTHETIC_OMS',
  'SYNTHETIC_ERP',
  'SYNTHETIC_BANK',
  'SYNTHETIC_RECOVERY',
  'SYNTHETIC_AGENT',
  'SYNTHETIC_ROUTE',
  'MONEYTRACE',
]);
export type SourceSystem = z.infer<typeof SourceSystem>;

/** The required metadata.environment for a given source system (schema 1.0). */
export function requiredEnvironmentFor(source: SourceSystem): 'test' | 'synthetic' {
  return source === 'RAZORPAY_TEST' ? 'test' : 'synthetic';
}

/** Route/merchant settlement scope — never join settlements by event name alone. */
export const SettlementScope = z.enum(['MERCHANT', 'RECIPIENT']);
export type SettlementScope = z.infer<typeof SettlementScope>;

/**
 * Environment tag carried in the event envelope metadata. Schema version 1.0
 * does NOT advertise `live`: the authoritative parser rejects live events, so the
 * public contract must not offer a value it always refuses.
 */
export const SourceEnvironment = z.enum(['test', 'synthetic']);
export type SourceEnvironment = z.infer<typeof SourceEnvironment>;
