/**
 * Shared, client-side demo-scenario state for the frontend fixture phase.
 *
 * Both the Overview/Demo-status fixtures and the Scenario Controller read and
 * write this single source of truth, so advancing a scenario in the drawer
 * deterministically changes what the Overview page renders (the "Agent claim
 * versus retained financial value" panel and the KPI cards) without any
 * backend, worker or database. State is persisted to `localStorage` so it
 * survives reloads and is global across demo roles — an operator advance is
 * visible to a viewer on the same browser.
 *
 * Step counts and labels here match the uploaded Overview design frames, not
 * the backend's step counts, because in fixture mode these frames ARE the
 * source of truth.
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

/**
 * Which frame the claim-truth panel shows, derived from the aggregate scenario
 * state. Kept small and explicit so the Overview fixture is a pure function of
 * this value.
 */
export type ClaimFrame =
  | 'none' // honest empty state — no agent claim in this stage
  | 'pending' // a scenario is mid-flight; a claim exists but is not yet concluded
  | 'verified_missing_transfer' // uploaded Image A: VERIFIED ₹4,55,000 with full chain
  | 'verified_reversal' // claim-reversal step 2: VERIFIED ₹1,20,000, no refund yet
  | 'reversed'; // uploaded Image B: REVERSED ₹0.00 after correlated refund

const STORAGE_KEY = 'moneytrace:demo-state';

/**
 * Fresh-browser default: the missing-transfer-remediation scenario is already
 * complete, so the Overview loads showing the VERIFIED ₹4,55,000 agent-claim
 * frame (uploaded Image A) immediately. Reset returns to the honest baseline.
 */
const DEFAULT_SEED: ScenarioSteps = { 'missing-transfer-remediation': 4 };

function totalFor(id: string): number {
  return DEMO_SCENARIOS.find((scenario) => scenario.id === id)?.totalSteps ?? 0;
}

function readStorage(): ScenarioSteps | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return null;
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        result[key] = Math.max(0, Math.min(totalFor(key), Math.trunc(value)));
      }
    }
    return result;
  } catch {
    return null;
  }
}

function writeStorage(steps: ScenarioSteps): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(steps));
  } catch {
    // Ignore — a private-mode or blocked store just means non-persistent demo.
  }
}

/** Current completed-step map, seeding the default on first ever load. */
export function getScenarioSteps(): ScenarioSteps {
  const stored = readStorage();
  if (stored === null) {
    writeStorage(DEFAULT_SEED);
    return DEFAULT_SEED;
  }
  return stored;
}

/** Advance one scenario by a single step (clamped to its total). Returns the new map. */
export function advanceScenario(id: string): ScenarioSteps {
  const current = getScenarioSteps();
  const next = { ...current, [id]: Math.min(totalFor(id), (current[id] ?? 0) + 1) };
  writeStorage(next);
  return next;
}

/** Return every scenario to its baseline (step 0) — the honest empty dataset. */
export function resetScenarios(): ScenarioSteps {
  const cleared: ScenarioSteps = {};
  writeStorage(cleared);
  return cleared;
}

/**
 * Pure mapping from scenario progress to the claim-truth frame the Overview
 * should render. Precedence favours the most instructive terminal outcome when
 * more than one scenario has been advanced.
 */
export function deriveClaimFrame(steps: ScenarioSteps): ClaimFrame {
  const reversal = steps['claim-reversal'] ?? 0;
  const missingTransfer = steps['missing-transfer-remediation'] ?? 0;
  if (reversal >= 3) return 'reversed';
  if (reversal >= 2) return 'verified_reversal';
  if (missingTransfer >= 4) return 'verified_missing_transfer';
  if (missingTransfer >= 1 || reversal >= 1) return 'pending';
  return 'none';
}
