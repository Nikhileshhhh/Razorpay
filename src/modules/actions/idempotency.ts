import { contentHash } from '../../config/hashing.js';

/**
 * Stable action idempotency key derivation (backend PRD §12.4): tenant, case,
 * plan hash, tool, and target — content-derived, never a random value, so a
 * repeated execute for the SAME approved plan always reserves the SAME action
 * row instead of a new one.
 */
export function computeActionIdempotencyKey(input: {
  readonly tenantId: string;
  readonly caseId: string;
  readonly planHash: string;
  readonly toolId: string;
  readonly target: string;
}): string {
  return contentHash({
    tenantId: input.tenantId,
    caseId: input.caseId,
    planHash: input.planHash,
    toolId: input.toolId,
    target: input.target,
  });
}

/** Request-body hash: same key + different body -> `409 IDEMPOTENCY_BODY_CONFLICT`. */
export function computeActionRequestHash(input: {
  readonly planId: string;
  readonly decisionBasisHash: string;
}): string {
  return contentHash({ planId: input.planId, decisionBasisHash: input.decisionBasisHash });
}
