import type { z } from 'zod';
import type { ClaimTruthComparison, DatasetManifest, Money } from '../../../contracts/index.js';
import { OverviewResponse } from '../../../contracts/index.js';
import {
  getActiveScenario,
  getDemoState,
  type ActiveScenario,
  type DemoState,
} from './demo-state.js';
import { FIXED_CLOCK, GENERATED_AT } from './support.js';

type OverviewResponse = z.infer<typeof OverviewResponse>;

/**
 * Scenario-aware fixture for `GET /v1/overview` (frontend fixture phase). The
 * "Agent claim versus retained financial value" panel, the KPI manifest and the
 * claim-reversal summary are all a pure function of the shared demo-scenario
 * state (see `demo-state.ts`): the **last scenario advanced**, at its **current
 * step**, drives every field below. That means advancing any one of the four
 * registered scenarios — one step at a time — always changes what this
 * function returns, with no precedence masking between scenarios. Everything
 * below is client-shaped fixture content; no browser arithmetic is performed
 * on the figures — each is a distinct pre-computed field.
 */

const inr = (amountMinor: string): Money => ({ amount_minor: amountMinor, currency: 'INR' });

const BASE_MANIFEST: DatasetManifest = {
  records_total: 500,
  records_matched: 468,
  unresolved_cases: 16,
  unsafe_candidate_matches_blocked: 4,
  unresolved_exposure: '128000000',
  verified_restored: '0',
  duplicate_collection_prevented: '50000000',
  reversed_recovery: '0',
};

/** Per-scenario, per-step KPI manifest. */
function manifestFor(active: ActiveScenario | null): DatasetManifest {
  if (!active) return BASE_MANIFEST;
  switch (active.id) {
    case 'claim-reversal':
      if (active.step >= 3) return { ...BASE_MANIFEST, reversed_recovery: '12000000' };
      if (active.step >= 2) return { ...BASE_MANIFEST, verified_restored: '12000000' };
      return BASE_MANIFEST;
    case 'missing-transfer-remediation':
      if (active.step >= 4) {
        return {
          ...BASE_MANIFEST,
          records_matched: 474,
          unresolved_cases: 15,
          verified_restored: '45500000',
        };
      }
      return BASE_MANIFEST;
    case 'conflicting-bank-evidence':
      if (active.step >= 3) {
        return {
          ...BASE_MANIFEST,
          unresolved_cases: 17,
          unresolved_exposure: '144000000',
          unsafe_candidate_matches_blocked: 5,
        };
      }
      if (active.step >= 2) {
        return { ...BASE_MANIFEST, unresolved_cases: 17, unresolved_exposure: '144000000' };
      }
      return BASE_MANIFEST;
    case 'duplicate-replay':
      if (active.step >= 4)
        return { ...BASE_MANIFEST, duplicate_collection_prevented: '100000000' };
      if (active.step >= 3) return { ...BASE_MANIFEST, duplicate_collection_prevented: '80000000' };
      if (active.step >= 2) return { ...BASE_MANIFEST, duplicate_collection_prevented: '60000000' };
      return BASE_MANIFEST;
    default:
      return BASE_MANIFEST;
  }
}

function claimReversalClaim(step: number): ClaimTruthComparison {
  const claimed = inr('12000000');
  const evidence_references = [
    { evidence_id: 'ev_cap_7c19', evidence_type: 'captured_payment' as const },
  ];
  if (step >= 3) {
    return {
      claim_id: 'claim_agt_2041',
      external_claim_id: 'demo_claim_reversal',
      claimed_amount: claimed,
      recovery_payment_observed: true,
      correlated_refund_amount: inr('12000000'),
      final_retained_value: inr('0'),
      verified_incremental_recovery: inr('0'),
      current_status: 'REVERSED',
      evidence_references,
      route_acknowledgement: null,
      verification_chain: null,
    };
  }
  if (step >= 2) {
    return {
      claim_id: 'claim_agt_2041',
      external_claim_id: 'demo_claim_reversal',
      claimed_amount: claimed,
      recovery_payment_observed: true,
      correlated_refund_amount: inr('0'),
      final_retained_value: claimed,
      verified_incremental_recovery: claimed,
      current_status: 'VERIFIED',
      evidence_references,
      route_acknowledgement: null,
      verification_chain: null,
    };
  }
  return {
    claim_id: 'claim_agt_2041',
    external_claim_id: 'demo_claim_reversal',
    claimed_amount: claimed,
    recovery_payment_observed: true,
    correlated_refund_amount: inr('0'),
    final_retained_value: inr('0'),
    verified_incremental_recovery: null,
    current_status: 'PENDING',
    evidence_references,
    route_acknowledgement: null,
    verification_chain: null,
  };
}

function missingTransferClaim(step: number): ClaimTruthComparison {
  const claimed = inr('45500000');
  const baseEvidence = [{ evidence_id: 'ev_cap_9f21', evidence_type: 'captured_payment' as const }];
  const withBankEvidence = [
    ...baseEvidence,
    { evidence_id: 'ev_bank_31ac', evidence_type: 'bank_credit' as const },
  ];
  const chain = (bankDone: boolean, allocDone: boolean, closureDone: boolean) => [
    {
      step: 'bank_evidence' as const,
      label: 'Independent bank evidence received',
      satisfied: bankDone,
      occurred_at: bankDone ? '2026-08-25T05:48:00Z' : null,
    },
    {
      step: 'unique_allocation' as const,
      label: 'Unique allocation — no double counting',
      satisfied: allocDone,
      occurred_at: allocDone ? '2026-08-25T05:52:00Z' : null,
    },
    {
      step: 'erp_closure' as const,
      label: 'ERP closure recorded',
      satisfied: closureDone,
      occurred_at: closureDone ? '2026-08-25T05:59:00Z' : null,
    },
  ];
  const routeAck = {
    acknowledged: true,
    source_system: 'SYNTHETIC_ROUTE' as const,
    occurred_at: '2026-08-25T05:16:00Z',
  };
  if (step >= 4) {
    return {
      claim_id: 'claim_agt_2077',
      external_claim_id: 'demo_missing_transfer_remediation',
      claimed_amount: claimed,
      recovery_payment_observed: true,
      correlated_refund_amount: inr('0'),
      final_retained_value: claimed,
      verified_incremental_recovery: claimed,
      current_status: 'VERIFIED',
      evidence_references: withBankEvidence,
      route_acknowledgement: routeAck,
      verification_chain: chain(true, true, true),
    };
  }
  if (step >= 3) {
    return {
      claim_id: 'claim_agt_2077',
      external_claim_id: 'demo_missing_transfer_remediation',
      claimed_amount: claimed,
      recovery_payment_observed: true,
      correlated_refund_amount: inr('0'),
      final_retained_value: inr('0'),
      verified_incremental_recovery: null,
      current_status: 'PENDING',
      evidence_references: withBankEvidence,
      route_acknowledgement: routeAck,
      verification_chain: chain(true, false, false),
    };
  }
  if (step >= 2) {
    return {
      claim_id: 'claim_agt_2077',
      external_claim_id: 'demo_missing_transfer_remediation',
      claimed_amount: claimed,
      recovery_payment_observed: true,
      correlated_refund_amount: inr('0'),
      final_retained_value: inr('0'),
      verified_incremental_recovery: null,
      current_status: 'PENDING',
      evidence_references: baseEvidence,
      route_acknowledgement: routeAck,
      verification_chain: chain(false, false, false),
    };
  }
  return {
    claim_id: 'claim_agt_2077',
    external_claim_id: 'demo_missing_transfer_remediation',
    claimed_amount: claimed,
    recovery_payment_observed: true,
    correlated_refund_amount: inr('0'),
    final_retained_value: inr('0'),
    verified_incremental_recovery: null,
    current_status: 'PENDING',
    evidence_references: baseEvidence,
    route_acknowledgement: null,
    verification_chain: chain(false, false, false),
  };
}

function conflictingBankEvidenceClaim(step: number): ClaimTruthComparison {
  const claimed = inr('16000000');
  const baseEvidence = [{ evidence_id: 'ev_cap_c210', evidence_type: 'captured_payment' as const }];
  const conflictingEvidence = [
    ...baseEvidence,
    { evidence_id: 'ev_bank_a51f', evidence_type: 'bank_credit' as const },
    { evidence_id: 'ev_bank_b62e', evidence_type: 'bank_credit' as const },
  ];
  if (step >= 2) {
    return {
      claim_id: 'claim_agt_2018',
      external_claim_id: 'demo_conflicting_bank_evidence',
      claimed_amount: claimed,
      recovery_payment_observed: true,
      correlated_refund_amount: inr('0'),
      final_retained_value: inr('0'),
      verified_incremental_recovery: null,
      current_status: 'UNRESOLVED',
      evidence_references: conflictingEvidence,
      route_acknowledgement: null,
      verification_chain: null,
    };
  }
  return {
    claim_id: 'claim_agt_2018',
    external_claim_id: 'demo_conflicting_bank_evidence',
    claimed_amount: claimed,
    recovery_payment_observed: true,
    correlated_refund_amount: inr('0'),
    final_retained_value: inr('0'),
    verified_incremental_recovery: null,
    current_status: 'PENDING',
    evidence_references: baseEvidence,
    route_acknowledgement: null,
    verification_chain: null,
  };
}

function duplicateReplayClaim(step: number): ClaimTruthComparison {
  const claimed = inr('20000000');
  const evidence_references = [
    { evidence_id: 'ev_cap_44de', evidence_type: 'captured_payment' as const },
  ];
  if (step >= 4) {
    return {
      claim_id: 'claim_agt_2090',
      external_claim_id: 'demo_duplicate_replay',
      claimed_amount: claimed,
      recovery_payment_observed: true,
      correlated_refund_amount: inr('0'),
      final_retained_value: inr('0'),
      verified_incremental_recovery: null,
      current_status: 'REJECTED',
      evidence_references,
      route_acknowledgement: null,
      verification_chain: null,
    };
  }
  return {
    claim_id: 'claim_agt_2090',
    external_claim_id: 'demo_duplicate_replay',
    claimed_amount: claimed,
    recovery_payment_observed: true,
    correlated_refund_amount: inr('0'),
    final_retained_value: inr('0'),
    verified_incremental_recovery: null,
    current_status: 'PENDING',
    evidence_references,
    route_acknowledgement: null,
    verification_chain: null,
  };
}

/** Per-scenario, per-step claim-truth comparison, or `null` when nothing is active. */
function claimTruthFor(active: ActiveScenario | null): ClaimTruthComparison | null {
  if (!active) return null;
  switch (active.id) {
    case 'claim-reversal':
      return claimReversalClaim(active.step);
    case 'missing-transfer-remediation':
      return missingTransferClaim(active.step);
    case 'conflicting-bank-evidence':
      return conflictingBankEvidenceClaim(active.step);
    case 'duplicate-replay':
      return duplicateReplayClaim(active.step);
    default:
      return null;
  }
}

function reversalSummaryFor(active: ActiveScenario | null): {
  reversed_recovery: Money;
  reversed_claims: number;
} {
  if (active?.id === 'claim-reversal' && active.step >= 3) {
    return { reversed_recovery: inr('12000000'), reversed_claims: 1 };
  }
  return { reversed_recovery: inr('0'), reversed_claims: 0 };
}

/** Build the full `/v1/overview` response for the given (or current) demo state. */
export function buildOverviewResponse(state: DemoState = getDemoState()): OverviewResponse {
  const active = getActiveScenario(state);
  const manifest = manifestFor(active);
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
      claim_truth_comparison: claimTruthFor(active),
      claim_reversal_summary: reversalSummaryFor(active),
    },
  });
}

/** Manifest for the current state — consumed by the demo-status fixture. */
export function currentManifest(state: DemoState = getDemoState()): DatasetManifest {
  return manifestFor(getActiveScenario(state));
}

/**
 * Demo overlay: when a live/mocked backend returns an overview whose dataset is
 * at baseline (no agent claim yet — `claim_truth_comparison === null`), fill in
 * the agent-claim panel, KPI manifest and reversal summary from the shared
 * client scenario state. This is exactly the user's situation — the persisted
 * baseline dataset has no seeded claim — and it lets the Demo Controller drive
 * the panel with no backend writes. When the backend already reports a claim
 * (or nothing has been advanced client-side), the response is returned
 * untouched, so real data and the existing tests are never overridden.
 */
export function overlayOverviewResponse(response: OverviewResponse): OverviewResponse {
  if (response.data.claim_truth_comparison !== null) return response;
  const state = getDemoState();
  const active = getActiveScenario(state);
  if (!active) return response;
  const built = buildOverviewResponse(state).data;
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
 * Backwards-compatible static export for the `withMockFallback` path used when
 * the backend is genuinely unreachable — a fixed, fully-populated representative
 * frame (missing-transfer-remediation, complete), independent of any client
 * scenario state so the truly-offline demo always shows the designed content.
 */
const OFFLINE_FALLBACK_STATE: DemoState = {
  steps: { 'missing-transfer-remediation': 4 },
  last: 'missing-transfer-remediation',
};
export const MOCK_MANIFEST: DatasetManifest = manifestFor(
  getActiveScenario(OFFLINE_FALLBACK_STATE),
);
export const MOCK_OVERVIEW_RESPONSE: OverviewResponse =
  buildOverviewResponse(OFFLINE_FALLBACK_STATE);
