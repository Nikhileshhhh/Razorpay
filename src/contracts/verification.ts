import { z } from 'zod';
import { boundedArray, boundedString, LIMITS } from './common/limits.js';
import { ActionId, EvidenceId, OpaqueId } from './common/identifiers.js';
import { MinorAmount, Money } from './common/money.js';
import { Rfc3339Utc } from './common/timestamps.js';
import { ContractVersion, SchemaVersion } from './common/versions.js';
import { FinancialAuthoritySourceSystem, NonAgentSourceSystem } from './authority.js';
import { BlockerType, EvidenceType } from './evidence.js';

/**
 * Outcome verification (handoff §8.15, PRD §17.13).
 *
 * A tool ACK is not proof of economic completion. `EFFECT_VERIFIED` requires
 * authoritative evidence, a verified amount, and a timestamp; a settlement
 * acknowledgement alone can never satisfy it. Amount equation / reconciliation
 * rule / reversal condition / escalation policy are OPAQUE REGISTERED IDs
 * (…_id), never executable expressions.
 *
 * The contract STRUCTURALLY guarantees all four Buildathon terminal checks
 * (amount, currency, identity, time) are present, each backed by at least one
 * sufficient-authority record, so a single UTR authority cannot satisfy every
 * check.
 */
export const VerificationOutcomeState = z.enum([
  'VERIFICATION_PENDING',
  'EFFECT_VERIFIED',
  'EFFECT_FAILED',
  'TIMED_OUT',
  'EFFECT_REVERSED',
]);
export type VerificationOutcomeState = z.infer<typeof VerificationOutcomeState>;

/** Fields a verification authority can attest (bounded, not an arbitrary string). */
export const VerificationField = z.enum([
  'amount',
  'currency',
  'identity',
  'time',
  'utr',
  'value_date',
  'recipient',
]);
export type VerificationField = z.infer<typeof VerificationField>;

/** Only classes sufficient for TERMINAL verification (§2.7 permits derived). */
export const VerificationAuthorityClass = z.enum(['AUTHORITATIVE', 'DERIVED']);
export type VerificationAuthorityClass = z.infer<typeof VerificationAuthorityClass>;

const terminalAuthorityRequirement = <F extends z.ZodType<string>>(field: F) =>
  z.discriminatedUnion('authority_class', [
    z
      .object({
        field,
        source_system: FinancialAuthoritySourceSystem,
        authority_class: z.literal('AUTHORITATIVE'),
      })
      .strict(),
    z
      .object({
        field,
        source_system: NonAgentSourceSystem,
        authority_class: z.literal('DERIVED'),
      })
      .strict(),
  ]);

const AmountAuthorityRequirement = terminalAuthorityRequirement(z.literal('amount'));
const CurrencyAuthorityRequirement = terminalAuthorityRequirement(z.literal('currency'));
const IdentityAuthorityRequirement = terminalAuthorityRequirement(
  z.enum(['identity', 'utr', 'recipient']),
);
const TimeAuthorityRequirement = terminalAuthorityRequirement(z.enum(['time', 'value_date']));

/** Public union of every valid field-specific authority requirement. */
export const FieldAuthorityRequirement = z.union([
  AmountAuthorityRequirement,
  CurrencyAuthorityRequirement,
  IdentityAuthorityRequirement,
  TimeAuthorityRequirement,
]);
export type FieldAuthorityRequirement = z.infer<typeof FieldAuthorityRequirement>;

/** All four checks must be explicitly required (a non-empty subset is invalid). */
export const RequiredChecks = z
  .object({
    amount: z.literal(true),
    currency: z.literal(true),
    identity: z.literal(true),
    time: z.literal(true),
  })
  .strict();

/** At least one sufficient-authority record per required check. */
export const RequiredAuthorities = z
  .object({
    amount: boundedArray(AmountAuthorityRequirement, LIMITS.ARRAY_MAX).min(1),
    currency: boundedArray(CurrencyAuthorityRequirement, LIMITS.ARRAY_MAX).min(1),
    identity: boundedArray(IdentityAuthorityRequirement, LIMITS.ARRAY_MAX).min(1),
    time: boundedArray(TimeAuthorityRequirement, LIMITS.ARRAY_MAX).min(1),
  })
  .strict();

/** Tolerances a contract permits (amount and value-date window). */
export const VerificationTolerances = z
  .object({
    amount_tolerance_minor: MinorAmount,
    value_date_window_days: z.number().int().min(0),
  })
  .strict();

export const VerificationContract = z
  .object({
    schema_version: SchemaVersion,
    contract_key: boundedString(LIMITS.CODE_MAX),
    version: ContractVersion,
    economic_subject_type: boundedString(LIMITS.CODE_MAX),
    // The action-effect contract terminates in EFFECT_VERIFIED (documented value).
    terminal_state: z.literal('EFFECT_VERIFIED'),
    required_evidence: boundedArray(EvidenceType, LIMITS.EVIDENCE_TYPES_MAX).min(1),
    optional_evidence: boundedArray(EvidenceType, LIMITS.EVIDENCE_TYPES_MAX),
    blocking_evidence: boundedArray(BlockerType, LIMITS.EVIDENCE_TYPES_MAX),
    required_checks: RequiredChecks,
    required_authorities: RequiredAuthorities,
    tolerances: VerificationTolerances,
    observation_window_seconds: z.number().int().positive(),
    amount_equation_id: OpaqueId,
    reconciliation_rule_id: OpaqueId,
    reversal_condition_ids: boundedArray(OpaqueId, LIMITS.RULES_MAX).min(1),
    escalation_policy_id: OpaqueId,
    expiry_seconds: z.number().int().positive(),
  })
  .strict();
export type VerificationContract = z.infer<typeof VerificationContract>;

// ---- status-dependent verification results ----
const verificationResultBase = {
  schema_version: SchemaVersion,
  verification_id: OpaqueId,
  action_id: ActionId,
  contract_version: ContractVersion,
};

const PendingResult = z
  .object({ ...verificationResultBase, status: z.literal('VERIFICATION_PENDING') })
  .strict();

const VerifiedResult = z
  .object({
    ...verificationResultBase,
    status: z.literal('EFFECT_VERIFIED'),
    evidence_ids: boundedArray(EvidenceId, LIMITS.EVIDENCE_IDS_MAX).min(1),
    verified_amount: Money,
    verified_at: Rfc3339Utc,
  })
  .strict();

const FailedResult = z
  .object({
    ...verificationResultBase,
    status: z.literal('EFFECT_FAILED'),
    failure_reason: boundedString(LIMITS.SHORT_TEXT),
    failed_at: Rfc3339Utc,
  })
  .strict();

const TimedOutResult = z
  .object({ ...verificationResultBase, status: z.literal('TIMED_OUT'), timed_out_at: Rfc3339Utc })
  .strict();

const ReversedResult = z
  .object({
    ...verificationResultBase,
    status: z.literal('EFFECT_REVERSED'),
    evidence_ids: boundedArray(EvidenceId, LIMITS.EVIDENCE_IDS_MAX).min(1),
    reversed_at: Rfc3339Utc,
  })
  .strict();

export const VerificationResult = z.discriminatedUnion('status', [
  PendingResult,
  VerifiedResult,
  FailedResult,
  TimedOutResult,
  ReversedResult,
]);
export type VerificationResult = z.infer<typeof VerificationResult>;
