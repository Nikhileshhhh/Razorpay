import { contentHash } from '../../config/hashing.js';

/**
 * Deterministic case identity (architecture handoff §10.2/§20.2, backend PRD
 * §10.2): `(tenant, control, economic subject, expectation version,
 * evaluation window)`. Concurrent/replayed violation evaluation always
 * resolves to the SAME key, so one active case epoch results regardless of how
 * many times the control re-fires on the same evidence.
 */
export interface CaseDedupeInput {
  readonly tenantId: string;
  readonly controlId: string;
  readonly subjectId: string;
  readonly expectationVersion: number;
  readonly evaluationWindow: string;
}

export function computeCaseDedupeKey(input: CaseDedupeInput): string {
  return contentHash(input);
}
