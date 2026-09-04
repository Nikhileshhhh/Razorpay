import type { z } from 'zod';
import type { ClaimTruthComparison, DatasetManifest, Money } from '../../../contracts/index.js';
import { OverviewResponse } from '../../../contracts/index.js';
import {
  deriveClaimFrame,
  getScenarioSteps,
  type ClaimFrame,
  type ScenarioSteps,
} from './demo-state.js';
import { FIXED_CLOCK, GENERATED_AT } from './support.js';

type OverviewResponse = z.infer<typeof OverviewResponse>;

/**
 * Scenario-aware fixture for `GET /v1/overview` (frontend fixture phase). The
 * "Agent claim versus retained financial value" panel, the KPI manifest and the
 * claim-reversal summary are all a pure function of the shared demo-scenario
 * state (see `demo-state.ts`), so advancing a scenario in the controller
 * deterministically re-renders the exact frames from the Overview design:
 *   • verified_missing_transfer → VERIFIED ₹4,55,000 with full verification chain
 *   • reversed                  → REVERSED ₹0.00 after a correlated refund
 * Everything below is client-shaped fixture content; no browser arithmetic is
 * performed on the figures — each is a distinct pre-computed field.
 */

const inr = (amountMinor: string): Money => ({ amount_minor: amountMinor, currency: 'INR' });

/** Per-frame KPI manifest. Figures mirror the Overview design frames. */
function manifestFor(frame: ClaimFrame): DatasetManifest {
  const base: DatasetManifest = {
    records_total: 500,
    records_matched: 468,
    unresolved_cases: 16,
    unsafe_candidate_matches_blocked: 4,
    unresolved_exposure: '128000000',
    verified_restored: '0',
    duplicate_collection_prevented: '50000000',
    reversed_recovery: '0',
  };
  switch (frame) {
    case 'verified_missing_transfer':
      return { ...base, records_matched: 474, unresolved_cases: 15, verified_restored: '45500000' };
    case 'verified_reversal':
      return { ...base, verified_restored: '12000000' };
    case 'reversed':
      return { ...base, reversed_recovery: '12000000' };
    case 'pending':
    case 'none':
    default:
      return base;
  }
}

/** Per-frame claim-truth comparison, or `null` for the honest empty baseline. */
function claimTruthFor(frame: ClaimFrame): ClaimTruthComparison | null {
  switch (frame) {
    case 'verified_missing_transfer':
      return {
        claim_id: 'claim_agt_2077',
        external_claim_id: 'demo_missing_transfer_remediation',
        claimed_amount: inr('45500000'),
        recovery_payment_observed: true,
        correlated_refund_amount: inr('0'),
        final_retained_value: inr('45500000'),
        verified_incremental_recovery: inr('45500000'),
        current_status: 'VERIFIED',
        evidence_references: [
          { evidence_id: 'ev_cap_9f21', evidence_type: 'captured_payment' },
          { evidence_id: 'ev_bank_31ac', evidence_type: 'bank_credit' },
        ],
        route_acknowledgement: {
          acknowledged: true,
          source_system: 'SYNTHETIC_ROUTE',
          occurred_at: '2026-08-25T05:16:00Z',
        },
        verification_chain: [
          {
            step: 'bank_evidence',
            label: 'Independent bank evidence received',
            satisfied: true,
            occurred_at: '2026-08-25T05:48:00Z',
          },
          {
            step: 'unique_allocation',
            label: 'Unique allocation — no double counting',
            satisfied: true,
            occurred_at: '2026-08-25T05:52:00Z',
          },
          {
            step: 'erp_closure',
            label: 'ERP closure recorded',
            satisfied: true,
            occurred_at: '2026-08-25T05:59:00Z',
          },
        ],
      };
    case 'verified_reversal':
      return {
        claim_id: 'claim_agt_2041',
        external_claim_id: 'demo_claim_reversal',
        claimed_amount: inr('12000000'),
        recovery_payment_observed: true,
        correlated_refund_amount: inr('0'),
        final_retained_value: inr('12000000'),
        verified_incremental_recovery: inr('12000000'),
        current_status: 'VERIFIED',
        evidence_references: [{ evidence_id: 'ev_cap_7c19', evidence_type: 'captured_payment' }],
        route_acknowledgement: null,
        verification_chain: null,
      };
    case 'reversed':
      return {
        claim_id: 'claim_agt_2041',
        external_claim_id: 'demo_claim_reversal',
        claimed_amount: inr('12000000'),
        recovery_payment_observed: true,
        correlated_refund_amount: inr('12000000'),
        final_retained_value: inr('0'),
        verified_incremental_recovery: inr('0'),
        current_status: 'REVERSED',
        evidence_references: [{ evidence_id: 'ev_cap_7c19', evidence_type: 'captured_payment' }],
        route_acknowledgement: null,
        verification_chain: null,
      };
    case 'pending':
      return {
        claim_id: 'claim_agt_2077',
        external_claim_id: 'demo_missing_transfer_remediation',
        claimed_amount: inr('45500000'),
        recovery_payment_observed: true,
        correlated_refund_amount: inr('0'),
        final_retained_value: inr('0'),
        verified_incremental_recovery: null,
        current_status: 'PENDING',
        evidence_references: [{ evidence_id: 'ev_cap_9f21', evidence_type: 'captured_payment' }],
        route_acknowledgement: null,
        verification_chain: [
          {
            step: 'bank_evidence',
            label: 'Independent bank evidence received',
            satisfied: false,
            occurred_at: null,
          },
          {
            step: 'unique_allocation',
            label: 'Unique allocation — no double counting',
            satisfied: false,
            occurred_at: null,
          },
          {
            step: 'erp_closure',
            label: 'ERP closure recorded',
            satisfied: false,
            occurred_at: null,
          },
        ],
      };
    case 'none':
    default:
      return null;
  }
}

function reversalSummaryFor(frame: ClaimFrame): {
  reversed_recovery: Money;
  reversed_claims: number;
} {
  if (frame === 'reversed') return { reversed_recovery: inr('12000000'), reversed_claims: 1 };
  return { reversed_recovery: inr('0'), reversed_claims: 0 };
}

/** Build the full `/v1/overview` response for the current scenario state. */
export function buildOverviewResponse(steps: ScenarioSteps = getScenarioSteps()): OverviewResponse {
  const frame = deriveClaimFrame(steps);
  const manifest = manifestFor(frame);
  return OverviewResponse.parse({
    schema_version: '1.0',
    request_id: 'req_mock_overview',
    data: {
      schema_version: '1.0',
      generated_at: GENERATED_AT,
      dataset_timestamp: FIXED_CLOCK,
      manifest,
      lifecycle_distribution: [
        { lifecycle_state: 'open', count: 16, exposure_amount: inr('64000000') },
        { lifecycle_state: 'investigating', count: 9, exposure_amount: inr('32000000') },
        { lifecycle_state: 'escalated', count: 4, exposure_amount: inr('16000000') },
        { lifecycle_state: 'expired', count: 3, exposure_amount: inr('16000000') },
        { lifecycle_state: 'reconciled', count: 24, exposure_amount: inr('0') },
        { lifecycle_state: 'closed_no_action', count: 9, exposure_amount: inr('0') },
      ],
      opened_closed_trend: [
        { date: '2026-08-19', opened: 17, closed: 10 },
        { date: '2026-08-20', opened: 23, closed: 14 },
        { date: '2026-08-21', opened: 15, closed: 19 },
        { date: '2026-08-22', opened: 28, closed: 17 },
        { date: '2026-08-23', opened: 12, closed: 22 },
        { date: '2026-08-24', opened: 9, closed: 15 },
        { date: '2026-08-25', opened: 20, closed: 7 },
      ],
      top_cases: [
        { case_id: 'CASE-2043', exposure_amount: inr('64000000'), lifecycle_state: 'open' },
        {
          case_id: 'CASE-2031',
          exposure_amount: inr('32000000'),
          lifecycle_state: 'investigating',
        },
        { case_id: 'CASE-2018', exposure_amount: inr('16000000'), lifecycle_state: 'escalated' },
      ],
      claim_truth_comparison: claimTruthFor(frame),
      claim_reversal_summary: reversalSummaryFor(frame),
    },
  });
}

/** Manifest for the current state — consumed by the demo-status fixture. */
export function currentManifest(steps: ScenarioSteps = getScenarioSteps()): DatasetManifest {
  return manifestFor(deriveClaimFrame(steps));
}

/**
 * Demo overlay: when a live/mocked backend returns an overview whose dataset is
 * at baseline (no agent claim yet — `claim_truth_comparison === null`), fill in
 * the agent-claim panel, KPI manifest and reversal summary from the shared
 * client scenario state. This is exactly the user's situation — the persisted
 * baseline dataset has no seeded claim — and it lets the Demo Controller drive
 * the panel with no backend writes. When the backend already reports a claim
 * (or the client has reset to baseline, frame `none`), the response is returned
 * untouched, so real data and the existing tests are never overridden.
 */
export function overlayOverviewResponse(response: OverviewResponse): OverviewResponse {
  if (response.data.claim_truth_comparison !== null) return response;
  const steps = getScenarioSteps();
  const frame = deriveClaimFrame(steps);
  if (frame === 'none') return response;
  const built = buildOverviewResponse(steps).data;
  return {
    ...response,
    data: {
      ...response.data,
      manifest: built.manifest,
      claim_truth_comparison: built.claim_truth_comparison,
      claim_reversal_summary: built.claim_reversal_summary,
    },
  };
}

/**
 * Backwards-compatible static export (default-seed frame) for the
 * `withMockFallback` path used when fixture mode is turned off.
 */
export const MOCK_MANIFEST: DatasetManifest = manifestFor('verified_missing_transfer');
export const MOCK_OVERVIEW_RESPONSE: OverviewResponse = buildOverviewResponse({
  'missing-transfer-remediation': 4,
});
