import { z } from 'zod';
import { boundedArray, boundedString, LIMITS } from './common/limits.js';
import { EvidenceId, RequestId } from './common/identifiers.js';
import { SupportedCurrency } from './common/money.js';
import { ResourceVersion, SchemaVersion } from './common/versions.js';

/**
 * Standard versioned error envelope (handoff §10, PRD §19.13, backend PRD
 * §14.3). `details` is a SAFE typed union keyed by `kind` — never an arbitrary
 * object, so an error can never smuggle secrets, raw source data, or PII. The
 * code enum contains exactly the documented error codes; unknown codes reject.
 *
 * `NOT_FOUND`, `APPROVAL_FORBIDDEN`, `SOURCE_UNAVAILABLE`, and `RATE_LIMITED`
 * are added per backend PRD §14.3 ("Use the standard safe envelope and
 * explicit codes including ... APPROVAL_FORBIDDEN ... SOURCE_UNAVAILABLE, and
 * RATE_LIMITED") on top of the original MT-002 set. `NOT_FOUND` is required
 * because §14.1/§14.2 register many `404` responses and no existing code fits
 * that case without overloading `SCHEMA_INVALID`'s meaning.
 */
export const ErrorCode = z.enum([
  'TENANT_SCOPE_REQUIRED',
  'SCHEMA_INVALID',
  'EVIDENCE_CONFLICT',
  'VERSION_CONFLICT',
  'POLICY_DENIED',
  'APPROVAL_STALE',
  'APPROVAL_FORBIDDEN',
  'IDEMPOTENCY_BODY_CONFLICT',
  'OUTCOME_UNKNOWN',
  'CURRENCY_MISMATCH',
  'RECONCILIATION_AMBIGUOUS',
  'VERIFICATION_INCOMPLETE',
  'OUTCOME_TRANSITION_FORBIDDEN',
  'NOT_FOUND',
  'SOURCE_UNAVAILABLE',
  'RATE_LIMITED',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

const NoDetails = z.object({ kind: z.literal('none') }).strict();

const ConflictingEvidenceDetails = z
  .object({
    kind: z.literal('conflicting_evidence'),
    conflicting_evidence_ids: boundedArray(EvidenceId, LIMITS.EVIDENCE_IDS_MAX),
  })
  .strict();

const VersionConflictDetails = z
  .object({
    kind: z.literal('version_conflict'),
    expected_version: ResourceVersion,
    actual_version: ResourceVersion,
  })
  .strict();

const CurrencyMismatchDetails = z
  .object({
    kind: z.literal('currency_mismatch'),
    expected_currency: SupportedCurrency,
    actual_currency: boundedString(8),
  })
  .strict();

export const ErrorDetails = z.discriminatedUnion('kind', [
  NoDetails,
  ConflictingEvidenceDetails,
  VersionConflictDetails,
  CurrencyMismatchDetails,
]);
export type ErrorDetails = z.infer<typeof ErrorDetails>;

export const ErrorEnvelope = z
  .object({
    schema_version: SchemaVersion,
    error: z
      .object({
        code: ErrorCode,
        message: boundedString(LIMITS.MESSAGE_MAX),
        request_id: RequestId,
        retryable: z.boolean(),
        details: ErrorDetails,
      })
      .strict(),
  })
  .strict();
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
