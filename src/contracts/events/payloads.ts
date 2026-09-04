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

/**
 * A terminal `SettlementObserved` (MoneyTrace normalization) may preserve the
 * recipient settlement's typed UTR and value date so verification can cross-check
 * them against the independent bank credit (ADR 0002 D7). These are OPTIONAL and
 * NEVER make settlement bank-credit proof — the bank authority bucket is still
 * satisfied only by a signed `SYNTHETIC_BANK` `BankCreditObserved`.
 */
export const SettlementObservedData = z
  .object({
    settlement_scope: SettlementScope,
    utr: Utr.nullish(),
    value_date: DateOnly.nullish(),
  })
  .strict();
