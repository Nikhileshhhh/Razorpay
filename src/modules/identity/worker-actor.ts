/**
 * Branded in-process identity for worker-only capabilities. It cannot be
 * constructed from an HTTP role string or serialized job payload.
 */
const trustedWorkerBrand: unique symbol = Symbol('moneytrace.trusted-worker');

export interface TrustedWorkerActor {
  readonly kind: 'trusted_worker';
  readonly role: 'worker';
  readonly [trustedWorkerBrand]: true;
}

export const MONEYTRACE_WORKER_ACTOR: TrustedWorkerActor = Object.freeze({
  kind: 'trusted_worker',
  role: 'worker',
  [trustedWorkerBrand]: true as const,
});
