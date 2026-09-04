import type { z } from 'zod';
import { DemoStatusResponse } from '../../../contracts/index.js';
import { DEMO_SCENARIOS, getScenarioSteps, type ScenarioSteps } from './demo-state.js';
import { currentManifest } from './overview.js';
import { FIXED_CLOCK, MANIFEST_HASH, SEED_ID } from './support.js';

type DemoStatusResponse = z.infer<typeof DemoStatusResponse>;

/**
 * Demo overlay: when a live/mocked backend reports every scenario at baseline
 * (step 0) but the client has advanced one in the Demo Controller, project the
 * client steps onto the status so the drawer's "completed step X of Y" and the
 * Overview stage chip reflect what the operator advanced — mirroring
 * {@link overlayOverviewResponse}. If any backend scenario is already advanced,
 * or the client is at baseline, the response is returned untouched.
 */
export function overlayDemoStatus(
  response: DemoStatusResponse,
  steps: ScenarioSteps = getScenarioSteps(),
): DemoStatusResponse {
  const scenarios = response.data.scenarios;
  const backendBaseline = scenarios.every(
    (scenario) => scenario.current_step === 0 && scenario.completed_step === 0,
  );
  const clientAdvanced = DEMO_SCENARIOS.some((scenario) => (steps[scenario.id] ?? 0) > 0);
  if (!backendBaseline || !clientAdvanced) return response;
  return {
    ...response,
    data: {
      ...response.data,
      manifest: currentManifest(steps),
      scenarios: scenarios.map((scenario) => {
        const registered = DEMO_SCENARIOS.find((entry) => entry.id === scenario.scenario_id);
        const total = registered?.totalSteps ?? scenario.total_steps;
        const step = Math.max(0, Math.min(total, steps[scenario.scenario_id] ?? 0));
        return {
          ...scenario,
          current_step: step,
          completed_step: step,
          total_steps: total,
          state_version: step,
          status: 'completed' as const,
        };
      }),
    },
  };
}

/**
 * Scenario-aware fixture for `GET /v1/demo/status`. Scenario ids and step
 * counts come from the shared demo-scenario state (`demo-state.ts`), so the
 * Scenario Controller drawer ("completed step X of Y") and the Overview stage
 * chip both reflect exactly what the operator has advanced. There is no async
 * worker in fixture mode, so a scenario never sits in `queued`; each reports
 * `completed` once its (synchronous) step settles — matching the real backend's
 * rule that `queued` means a step is durably in flight.
 */
export function buildDemoStatusResponse(
  steps: ScenarioSteps = getScenarioSteps(),
): DemoStatusResponse {
  return {
    schema_version: '1.0',
    request_id: 'req_mock_demo_status',
    data: {
      schema_version: '1.0',
      seed_id: SEED_ID,
      ready: true,
      fixed_clock: FIXED_CLOCK,
      manifest_hash: MANIFEST_HASH,
      manifest: currentManifest(steps),
      scenarios: DEMO_SCENARIOS.map((scenario) => {
        const step = Math.max(0, Math.min(scenario.totalSteps, steps[scenario.id] ?? 0));
        return {
          scenario_id: scenario.id,
          current_step: step,
          completed_step: step,
          total_steps: scenario.totalSteps,
          state_version: step,
          status: 'completed' as const,
          last_error: null,
        };
      }),
    },
  };
}

/** Static default-seed export for the `withMockFallback` path (fixture mode off). */
export const MOCK_DEMO_STATUS_RESPONSE: DemoStatusResponse = buildDemoStatusResponse({
  'missing-transfer-remediation': 4,
});
