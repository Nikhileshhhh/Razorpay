/**
 * Shared, client-side demo-scenario state for the frontend fixture phase.
 *
 * Both the Overview/Demo-status fixtures and the Scenario Controller read and
 * write this single source of truth, so advancing a scenario in the drawer
 * deterministically changes what the Overview page renders (the "Agent claim
 * versus retained financial value" panel and the KPI cards) with no backend.
 *
 * Model: the Overview reflects the **most recently advanced** scenario at its
 * current step ("last advanced wins"). That removes precedence masking and makes
 * every scenario's progression visible. State persists to `localStorage` so it
 * survives reloads and is shared across demo roles on the same browser.
 */

export interface ScenarioDef {
  readonly id: string;
  readonly totalSteps: number;
}

/** Registered synthetic scenarios, in the order the drawer lists them. */
export const DEMO_SCENARIOS: readonly ScenarioDef[] = [
  { id: 'claim-reversal', totalSteps: 3 },
  { id: 'missing-transfer-remediation', totalSteps: 4 },
  { id: 'conflicting-bank-evidence', totalSteps: 3 },
  { id: 'duplicate-replay', totalSteps: 4 },
];

/** Completed step per scenario id. Absent id ⇒ step 0 (untouched). */
export type ScenarioSteps = Readonly<Record<string, number>>;

/** Persisted demo state: per-scenario steps + the last scenario advanced. */
export interface DemoState {
  readonly steps: ScenarioSteps;
  readonly last: string | null;
}

/** The scenario currently driving the Overview (last advanced, step > 0). */
export interface ActiveScenario {
  readonly id: string;
  readonly step: number;
  readonly total: number;
}

const STORAGE_KEY = 'moneytrace:demo-state';

/** Fresh browser / after reset: nothing advanced → the Overview shows the honest
 * empty claim panel and baseline KPIs, so advancing any scenario is clearly what
 * populates the page. */
const DEFAULT_STATE: DemoState = { steps: {}, last: null };

function totalFor(id: string): number {
  return DEMO_SCENARIOS.find((scenario) => scenario.id === id)?.totalSteps ?? 0;
}

function sanitizeSteps(raw: Record<string, unknown>): ScenarioSteps {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const clamped = Math.max(0, Math.min(totalFor(key), Math.trunc(value)));
      if (clamped > 0) result[key] = clamped;
    }
  }
  return result;
}

function readState(): DemoState {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_STATE;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return DEFAULT_STATE;
    const obj = parsed as Record<string, unknown>;
    // New shape: { steps, last }. Old shape (back-compat): a flat step map.
    if (obj.steps && typeof obj.steps === 'object') {
      const steps = sanitizeSteps(obj.steps as Record<string, unknown>);
      const last = typeof obj.last === 'string' && steps[obj.last] ? obj.last : null;
      return { steps, last };
    }
    return { steps: sanitizeSteps(obj), last: null };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeState(state: DemoState): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private-mode / blocked store — demo just becomes non-persistent.
  }
}

/** Full current demo state. */
export function getDemoState(): DemoState {
  return readState();
}

/** Current completed-step map — consumed by the demo-status fixture. */
export function getScenarioSteps(): ScenarioSteps {
  return readState().steps;
}

/** Advance one scenario by a single step (clamped) and mark it the active one. */
export function advanceScenario(id: string): DemoState {
  const current = readState();
  const nextStep = Math.min(totalFor(id), (current.steps[id] ?? 0) + 1);
  const next: DemoState = {
    steps: { ...current.steps, [id]: nextStep },
    last: id,
  };
  writeState(next);
  return next;
}

/** Return every scenario to baseline (empty) — the honest empty dataset. */
export function resetScenarios(): DemoState {
  writeState(DEFAULT_STATE);
  return DEFAULT_STATE;
}

/**
 * The scenario the Overview should reflect: the last-advanced one, at its current
 * step. `null` when nothing has been advanced (baseline / empty claim panel).
 */
export function getActiveScenario(state: DemoState = readState()): ActiveScenario | null {
  const id = state.last;
  if (!id) return null;
  const step = state.steps[id] ?? 0;
  if (step <= 0) return null;
  return { id, step, total: totalFor(id) };
}
