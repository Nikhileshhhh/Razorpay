import { z } from 'zod';
import { boundedString, LIMITS } from './common/limits.js';
import { EvidenceId } from './common/identifiers.js';
import { ContractVersion, SchemaVersion } from './common/versions.js';
import { SourceSystem } from './events/event-types.js';

/**
 * Field/contract-specific source authority (architecture §2.7).
 *
 * Authority is NEVER a global boolean attached to a whole source — it is scoped
 * to a specific fact/field, source system, and contract basis. It is IMPOSSIBLE
 * to parse an AUTHORITATIVE (or ASSERTED/DERIVED) claim without evidence AND a
 * contract basis+version: those classes require them. An agent result is an
 * UNTRUSTED_CLAIM; MoneyTrace policy/approval/action/audit are CONTROL_EVIDENCE;
 * settlement processing and API acks are ACKNOWLEDGEMENT_ONLY (never bank-credit
 * authority). Every class requires an `evidence_ref`.
 */
export const AuthorityClass = z.enum([
  'AUTHORITATIVE',
  'ASSERTED',
  'DERIVED',
  'CANDIDATE',
  'UNTRUSTED_CLAIM',
  'CONTROL_EVIDENCE',
  'ACKNOWLEDGEMENT_ONLY',
]);
export type AuthorityClass = z.infer<typeof AuthorityClass>;

const authorityBase = {
  schema_version: SchemaVersion,
  fact: boundedString(LIMITS.SHORT_TEXT),
  scope: boundedString(LIMITS.SHORT_TEXT).nullable(),
  evidence_ref: EvidenceId,
};

/** Systems permitted to originate financial source evidence. */
export const FinancialAuthoritySourceSystem = SourceSystem.exclude([
  'SYNTHETIC_AGENT',
  'MONEYTRACE',
]);
export type FinancialAuthoritySourceSystem = z.infer<typeof FinancialAuthoritySourceSystem>;

/** Derived/control evidence may be produced internally, but never by an agent claim. */
export const NonAgentSourceSystem = SourceSystem.exclude(['SYNTHETIC_AGENT']);
export type NonAgentSourceSystem = z.infer<typeof NonAgentSourceSystem>;

/** AUTHORITATIVE/ASSERTED/DERIVED additionally require a contract basis+version. */
const strongAuthority = <
  C extends 'AUTHORITATIVE' | 'ASSERTED' | 'DERIVED',
  S extends z.ZodType<string>,
>(
  cls: C,
  sourceSystem: S,
) =>
  z
    .object({
      ...authorityBase,
      source_system: sourceSystem,
      authority_class: z.literal(cls),
      contract_basis: boundedString(LIMITS.SHORT_TEXT),
      contract_version: ContractVersion,
    })
    .strict();

/** Weaker classes require evidence but not a contract basis. */
const weakAuthority = (cls: 'CANDIDATE' | 'CONTROL_EVIDENCE' | 'ACKNOWLEDGEMENT_ONLY') =>
  z
    .object({
      ...authorityBase,
      source_system: NonAgentSourceSystem,
      authority_class: z.literal(cls),
      contract_basis: boundedString(LIMITS.SHORT_TEXT).nullable(),
      contract_version: ContractVersion.nullable(),
    })
    .strict();

/** Agent output has exactly one authority class: an untrusted external claim. */
const UntrustedAgentClaim = z
  .object({
    ...authorityBase,
    source_system: z.literal('SYNTHETIC_AGENT'),
    authority_class: z.literal('UNTRUSTED_CLAIM'),
    contract_basis: boundedString(LIMITS.SHORT_TEXT).nullable(),
    contract_version: ContractVersion.nullable(),
  })
  .strict();

export const SourceAuthorityRecord = z.discriminatedUnion('authority_class', [
  strongAuthority('AUTHORITATIVE', FinancialAuthoritySourceSystem),
  strongAuthority('ASSERTED', FinancialAuthoritySourceSystem),
  strongAuthority('DERIVED', NonAgentSourceSystem),
  weakAuthority('CANDIDATE'),
  UntrustedAgentClaim,
  weakAuthority('CONTROL_EVIDENCE'),
  weakAuthority('ACKNOWLEDGEMENT_ONLY'),
]);
export type SourceAuthorityRecord = z.infer<typeof SourceAuthorityRecord>;
