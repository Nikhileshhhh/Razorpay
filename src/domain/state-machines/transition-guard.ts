/**
 * Generic finite-state transition guard.
 *
 * Each domain state machine (financial outcome, case lifecycle, agent claim,
 * plan, approval, action, verification) is declared as an explicit adjacency
 * map of `fromState -> allowed toStates`. This module owns ONLY the pure graph
 * check — persistence, optimistic-version comparison, and side effects belong
 * to the service layer that calls it (backend PRD §5.2: state machines "must
 * not own persistence or UI state").
 */
export class ForbiddenTransitionError extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`forbidden transition in ${machine}: ${from} -> ${to}`);
    this.name = 'ForbiddenTransitionError';
  }
}

export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

export function isAllowedTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S,
): boolean {
  return (map[from] ?? []).includes(to);
}

/** Throws {@link ForbiddenTransitionError} (maps to `409` at the API boundary) if not allowed. */
export function assertAllowedTransition<S extends string>(
  machineName: string,
  map: TransitionMap<S>,
  from: S,
  to: S,
): void {
  if (from === to) return; // idempotent no-op transitions are allowed by callers that check first
  if (!isAllowedTransition(map, from, to)) {
    throw new ForbiddenTransitionError(machineName, from, to);
  }
}
