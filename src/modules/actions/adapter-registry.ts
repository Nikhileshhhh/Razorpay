import type { ToolActionId } from '../../contracts/plans.js';

/**
 * Closed typed adapter registry (backend PRD §12.4/§17): "only the worker may
 * own adapter capability" — this module is imported ONLY from worker job code
 * (`dispatch-action.v1`), never from the API process. It contains SIMULATED
 * Route and recovery effects only; there is no generic HTTP/SQL/URL executor
 * and no real payment/transfer/refund call. `REQUEST_MORE_EVIDENCE` and
 * `CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION` have no adapter in Gate B3
 * — see policy-engine.ts, which denies the latter, and approvals's own
 * `request-more-evidence` endpoint, which realizes the former without
 * dispatch.
 */
export type AdapterOutcome = 'ACKNOWLEDGED' | 'FAILED' | 'OUTCOME_UNKNOWN';

export interface AdapterDispatchResult {
  readonly outcome: AdapterOutcome;
  readonly externalReference: string | null;
}

export interface AdapterDispatchInput {
  readonly actionId: string;
  /** TEST-ONLY deterministic fault injection — never settable via a public API
   * request body; wired only by the action-service's own test-only parameter,
   * itself only reachable from server-side test/integration code. */
  readonly forcedOutcome?: AdapterOutcome;
}

/** Synthetic Route adapter — acknowledges one simulated transfer (backend PRD §13.1). */
function dispatchSyntheticRoute(input: AdapterDispatchInput): AdapterDispatchResult {
  if (input.forcedOutcome) {
    return {
      outcome: input.forcedOutcome,
      externalReference:
        input.forcedOutcome === 'FAILED' ? null : `synthetic_route_${input.actionId}`,
    };
  }
  return { outcome: 'ACKNOWLEDGED', externalReference: `synthetic_route_${input.actionId}` };
}

/** Synthetic recovery adapter — acknowledges one simulated suppression. */
function dispatchSyntheticRecovery(input: AdapterDispatchInput): AdapterDispatchResult {
  if (input.forcedOutcome) {
    return {
      outcome: input.forcedOutcome,
      externalReference:
        input.forcedOutcome === 'FAILED' ? null : `synthetic_recovery_${input.actionId}`,
    };
  }
  return { outcome: 'ACKNOWLEDGED', externalReference: `synthetic_recovery_${input.actionId}` };
}

/** Synthetic ERP adapter: ACK means the closure request was accepted only. */
function dispatchSyntheticErp(input: AdapterDispatchInput): AdapterDispatchResult {
  if (input.forcedOutcome) {
    return {
      outcome: input.forcedOutcome,
      externalReference:
        input.forcedOutcome === 'FAILED' ? null : `synthetic_erp_${input.actionId}`,
    };
  }
  return { outcome: 'ACKNOWLEDGED', externalReference: `synthetic_erp_${input.actionId}` };
}

type Adapter = (input: AdapterDispatchInput) => AdapterDispatchResult;

const ADAPTERS: Partial<Record<ToolActionId, Adapter>> = {
  SIMULATE_TRANSFER_REMEDIATION: dispatchSyntheticRoute,
  SUPPRESS_SIMULATED_RECOVERY: dispatchSyntheticRecovery,
  CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION: dispatchSyntheticErp,
};

export class NoAdapterRegisteredError extends Error {
  constructor(readonly toolId: string) {
    super(`no synthetic adapter is registered for tool: ${toolId}`);
    this.name = 'NoAdapterRegisteredError';
  }
}

/**
 * Dispatch through the closed registry. `toolId` values outside the two
 * simulated effects (a registered-but-not-yet-dispatchable tool, or anything
 * unregistered) fail closed rather than silently no-op or fabricate success.
 */
export function dispatchThroughAdapter(
  toolId: ToolActionId,
  input: AdapterDispatchInput,
): AdapterDispatchResult {
  const adapter = ADAPTERS[toolId];
  if (!adapter) throw new NoAdapterRegisteredError(toolId);
  return adapter(input);
}
