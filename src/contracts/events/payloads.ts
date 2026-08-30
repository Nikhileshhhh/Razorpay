import { z } from 'zod';
import { DateOnly, Utr } from '../common/identifiers.js';
import { SettlementScope } from './event-types.js';

/**
 * Per-event-type `data` schemas.
 *
 * These are intentionally MINIMAL and strict. Canonical identity/money fields
 * live in the envelope (amount_minor, currency, entity_references,
 * economic_subject_hint). Only fields explicitly justified by the controlling
 * documents appear here; any adapter-specific field that is not documented is
 * preserved through raw evidence (`raw_payload_ref`), never invented as a
 * canonical field.
 */
export const EmptyData = z.object({}).strict();

/** Bank credit carries the authoritative UTR and value date (handoff §2.7/§7.4). */
export const BankCreditObservedData = z.object({ utr: Utr, value_date: DateOnly }).strict();

/** Settlement events preserve their scope so recipient vs merchant never conflate. */
export const SettlementScopedData = z.object({ settlement_scope: SettlementScope }).strict();
