import { z } from 'zod';
import { boundedArray, boundedString, LIMITS } from '../common/limits.js';
import { CanonicalEventType, SourceSystem } from './event-types.js';

/**
 * Canonical event -> source classification and the EXECUTABLE source-system
 * provenance registry (architecture §8.2, §2.7).
 *
 * `may_originate_from` is a descriptive origin class; `allowed_source_systems` is
 * the enforceable allowlist that `CanonicalEvent` validates against. This
 * prevents misrepresentation: e.g. a caller cannot label a BankCreditObserved or
 * SyntheticTransferFailed as `RAZORPAY_TEST`. The signed Razorpay-shaped
 * synthetic fallback (§2.7) is the explicit `SYNTHETIC_RAZORPAY_FIXTURE` source,
 * never `RAZORPAY_TEST`.
 */
export const EventOriginClass = z.enum([
  'RAZORPAY_WEBHOOK_OR_FETCH',
  'RAZORPAY_FETCH_OR_API',
  'CANONICAL_OBSERVATION',
  'SYNTHETIC_CAPABLE',
  'SYNTHETIC_REQUIRED',
  'MONEYTRACE_INTERNAL',
]);
export type EventOriginClass = z.infer<typeof EventOriginClass>;

export const CanonicalEventClassification = z
  .object({
    event_type: CanonicalEventType,
    may_originate_from: boundedArray(EventOriginClass, 4).min(1),
    allowed_source_systems: boundedArray(SourceSystem, 8).min(1),
    is_bank_credit_evidence: z.boolean(),
    notes: boundedString(LIMITS.NOTES_MAX),
  })
  .strict();
export type CanonicalEventClassification = z.infer<typeof CanonicalEventClassification>;

const RAZORPAY_OR_FIXTURE: SourceSystem[] = ['RAZORPAY_TEST', 'SYNTHETIC_RAZORPAY_FIXTURE'];
const RAZORPAY_OR_ROUTE: SourceSystem[] = ['RAZORPAY_TEST', 'SYNTHETIC_ROUTE'];

const RAW: z.infer<typeof CanonicalEventClassification>[] = [
  {
    event_type: 'OrderCreated',
    may_originate_from: ['RAZORPAY_FETCH_OR_API', 'SYNTHETIC_CAPABLE'],
    allowed_source_systems: ['RAZORPAY_TEST', 'SYNTHETIC_OMS'],
    is_bank_credit_evidence: false,
    notes: 'Orders API fetch/response or synthetic OMS event; not a webhook.',
  },
  {
    event_type: 'OrderPaid',
    may_originate_from: ['RAZORPAY_WEBHOOK_OR_FETCH'],
    allowed_source_systems: RAZORPAY_OR_FIXTURE,
    is_bank_credit_evidence: false,
    notes: 'Public order.paid webhook/fetch, or signed Razorpay-shaped fixture.',
  },
  {
    event_type: 'PaymentAuthorized',
    may_originate_from: ['RAZORPAY_WEBHOOK_OR_FETCH'],
    allowed_source_systems: RAZORPAY_OR_FIXTURE,
    is_bank_credit_evidence: false,
    notes: 'Public payment.authorized webhook/fetch, or signed fixture.',
  },
  {
    event_type: 'PaymentCaptured',
    may_originate_from: ['RAZORPAY_WEBHOOK_OR_FETCH'],
    allowed_source_systems: RAZORPAY_OR_FIXTURE,
    is_bank_credit_evidence: false,
    notes: 'Public payment.captured webhook/fetch, or signed fixture.',
  },
  {
    event_type: 'PaymentFailed',
    may_originate_from: ['RAZORPAY_WEBHOOK_OR_FETCH'],
    allowed_source_systems: RAZORPAY_OR_FIXTURE,
    is_bank_credit_evidence: false,
    notes: 'Public payment.failed webhook/fetch, or signed fixture.',
  },
  {
    event_type: 'RefundCreated',
    may_originate_from: ['RAZORPAY_WEBHOOK_OR_FETCH', 'SYNTHETIC_CAPABLE'],
    allowed_source_systems: RAZORPAY_OR_FIXTURE,
    is_bank_credit_evidence: false,
    notes: 'Refund API/webhook/fetch, or signed fixture.',
  },
  {
    event_type: 'RefundProcessed',
    may_originate_from: ['RAZORPAY_WEBHOOK_OR_FETCH', 'SYNTHETIC_CAPABLE'],
    allowed_source_systems: RAZORPAY_OR_FIXTURE,
    is_bank_credit_evidence: false,
    notes: 'Refund API/webhook/fetch; reversal proof remains contract-dependent.',
  },
  {
    event_type: 'RefundFailed',
    may_originate_from: ['RAZORPAY_WEBHOOK_OR_FETCH', 'SYNTHETIC_CAPABLE'],
    allowed_source_systems: RAZORPAY_OR_FIXTURE,
    is_bank_credit_evidence: false,
    notes: 'Refund API/webhook/fetch, or signed fixture.',
  },
  {
    event_type: 'TransferCreated',
    may_originate_from: ['RAZORPAY_FETCH_OR_API', 'SYNTHETIC_CAPABLE'],
    allowed_source_systems: RAZORPAY_OR_ROUTE,
    is_bank_credit_evidence: false,
    notes: 'Route transfer API response/fetch; synthetic Route fallback.',
  },
  {
    event_type: 'TransferProcessed',
    may_originate_from: ['RAZORPAY_WEBHOOK_OR_FETCH', 'SYNTHETIC_CAPABLE'],
    allowed_source_systems: RAZORPAY_OR_ROUTE,
    is_bank_credit_evidence: false,
    notes: 'Public transfer.processed Route webhook/fetch; synthetic Route fallback.',
  },
  {
    event_type: 'SettlementCreated',
    may_originate_from: ['CANONICAL_OBSERVATION'],
    allowed_source_systems: RAZORPAY_OR_ROUTE,
    is_bank_credit_evidence: false,
    notes: 'Settlement fetch/adapter observation; not a claimed Razorpay webhook.',
  },
  {
    event_type: 'SettlementProcessed',
    may_originate_from: ['RAZORPAY_WEBHOOK_OR_FETCH'],
    allowed_source_systems: RAZORPAY_OR_ROUTE,
    is_bank_credit_evidence: false,
    notes: 'Public settlement.processed with explicit scope; NOT bank-credit proof.',
  },
  {
    event_type: 'SettlementObserved',
    may_originate_from: ['CANONICAL_OBSERVATION'],
    allowed_source_systems: RAZORPAY_OR_ROUTE,
    is_bank_credit_evidence: false,
    notes: 'MoneyTrace normalization; never presented as an upstream Razorpay event.',
  },
  {
    event_type: 'BankCreditObserved',
    may_originate_from: ['SYNTHETIC_REQUIRED'],
    allowed_source_systems: ['SYNTHETIC_BANK'],
    is_bank_credit_evidence: true,
    notes: 'Signed synthetic bank connector; the authoritative bank-credit evidence.',
  },
  {
    event_type: 'SellerReceivableOpened',
    may_originate_from: ['SYNTHETIC_REQUIRED'],
    allowed_source_systems: ['SYNTHETIC_ERP'],
    is_bank_credit_evidence: false,
    notes: 'Signed synthetic ERP connector.',
  },
  {
    event_type: 'SellerReceivableClosed',
    may_originate_from: ['SYNTHETIC_REQUIRED'],
    allowed_source_systems: ['SYNTHETIC_ERP'],
    is_bank_credit_evidence: false,
    notes: 'Signed synthetic ERP connector.',
  },
  {
    event_type: 'RecoveryScheduled',
    may_originate_from: ['SYNTHETIC_REQUIRED'],
    allowed_source_systems: ['SYNTHETIC_RECOVERY'],
    is_bank_credit_evidence: false,
    notes: 'Signed synthetic recovery connector; messaging is never real.',
  },
  {
    event_type: 'RecoverySuppressed',
    may_originate_from: ['SYNTHETIC_REQUIRED'],
    allowed_source_systems: ['SYNTHETIC_RECOVERY'],
    is_bank_credit_evidence: false,
    notes: 'Signed synthetic recovery connector.',
  },
  {
    event_type: 'AgentResultClaimed',
    may_originate_from: ['MONEYTRACE_INTERNAL'],
    allowed_source_systems: ['SYNTHETIC_AGENT', 'MONEYTRACE'],
    is_bank_credit_evidence: false,
    notes: 'Agent Results API; an untrusted claim, never Razorpay source truth.',
  },
  {
    event_type: 'SyntheticTransferFailed',
    may_originate_from: ['SYNTHETIC_REQUIRED'],
    allowed_source_systems: ['SYNTHETIC_ROUTE'],
    is_bank_credit_evidence: false,
    notes: 'Synthetic adapter failure event; never represented as a Razorpay fact.',
  },
];

/** Validated at module load so the inventory can never drift out of schema. */
export const CANONICAL_EVENT_CLASSIFICATIONS = z.array(CanonicalEventClassification).parse(RAW);

const BY_TYPE = new Map(CANONICAL_EVENT_CLASSIFICATIONS.map((c) => [c.event_type, c]));

/** Executable allowlist of source systems for a canonical event type. */
export function allowedSourceSystemsFor(eventType: CanonicalEventType): readonly SourceSystem[] {
  return BY_TYPE.get(eventType)?.allowed_source_systems ?? [];
}
