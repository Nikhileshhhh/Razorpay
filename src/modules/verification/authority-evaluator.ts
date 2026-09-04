import type { VerificationContract, VerificationField } from '../../contracts/verification.js';
import type { EvidenceType } from '../../contracts/evidence.js';
import type { SourceSystem } from '../../contracts/events/event-types.js';

/**
 * A single field-authority observation the caller found in persisted evidence
 * for one required check (amount/currency/identity/time). Pure data — the
 * caller (verification-service) is responsible for deciding which real
 * evidence rows produced it; this module only judges whether the CONTRACT'S
 * requirements are met (ADR 0002 D7: predicates are contract-specific, not a
 * single universal rule).
 */
export interface AuthorityFact {
  readonly field: VerificationField;
  readonly sourceSystem: SourceSystem;
  readonly authorityClass: 'AUTHORITATIVE' | 'DERIVED';
}

export interface AuthorityEvaluationInput {
  readonly contract: VerificationContract;
  /** Evidence types the caller confirmed exist as accepted, non-quarantined rows. */
  readonly presentEvidenceTypes: ReadonlySet<EvidenceType>;
  /** Blocking evidence types the caller confirmed exist (refund/dispute/etc). */
  readonly presentBlockers: ReadonlySet<string>;
  /** Every authority fact the caller found supporting amount/currency/identity/time. */
  readonly facts: readonly AuthorityFact[];
}

export type AuthorityDecision =
  | { readonly status: 'EFFECT_VERIFIED' }
  | { readonly status: 'VERIFICATION_PENDING'; readonly blockers: readonly string[] };

const CHECK_FIELDS: readonly (keyof VerificationContract['required_checks'])[] = [
  'amount',
  'currency',
  'identity',
  'time',
];

/**
 * Pure authority evaluator (ADR 0002 D7, backend PRD §7.4). A contract's
 * required checks are satisfied ONLY when, for each required bucket, at least
 * one fact matches a registered `required_authorities[bucket]` entry EXACTLY
 * (same field family, same source system, same-or-stronger authority class).
 * `SYNTHETIC_AGENT` can never appear in `required_authorities` (the seeded
 * contracts never register it), so an agent fact can never satisfy a bucket —
 * this is structural, not a runtime special case.
 */
export function evaluateContractAuthority(input: AuthorityEvaluationInput): AuthorityDecision {
  const blockers: string[] = [];

  for (const required of input.contract.required_evidence) {
    if (!input.presentEvidenceTypes.has(required)) {
      blockers.push(`MISSING_REQUIRED_EVIDENCE:${required}`);
    }
  }
  for (const blocking of input.contract.blocking_evidence) {
    if (input.presentBlockers.has(blocking)) {
      blockers.push(`BLOCKED_BY:${blocking}`);
    }
  }

  for (const bucket of CHECK_FIELDS) {
    if (!input.contract.required_checks[bucket]) continue;
    const requirements = input.contract.required_authorities[bucket];
    const satisfied = requirements.some((requirement) =>
      input.facts.some(
        (fact) =>
          fact.field === requirement.field &&
          fact.sourceSystem === requirement.source_system &&
          // A DERIVED requirement accepts either class; an AUTHORITATIVE
          // requirement accepts only an AUTHORITATIVE fact — never weakened.
          (requirement.authority_class === 'DERIVED' || fact.authorityClass === 'AUTHORITATIVE'),
      ),
    );
    if (!satisfied) blockers.push(`INSUFFICIENT_AUTHORITY:${bucket}`);
  }

  if (blockers.length > 0) return { status: 'VERIFICATION_PENDING', blockers };
  return { status: 'EFFECT_VERIFIED' };
}
