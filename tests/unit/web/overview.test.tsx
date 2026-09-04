// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/web/app/App.js';

class TestResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const manifest = {
  records_total: 500,
  records_matched: 468,
  unresolved_cases: 16,
  unsafe_candidate_matches_blocked: 4,
  unresolved_exposure: '128000000',
  verified_restored: '0',
  duplicate_collection_prevented: '50000000',
  reversed_recovery: '12000000',
};

const statusResponse = {
  schema_version: '1.0',
  request_id: 'req_status',
  data: {
    schema_version: '1.0',
    seed_id: 'moneytrace_demo_v1',
    ready: true,
    fixed_clock: '2026-08-25T05:20:00.000Z',
    manifest_hash: `sha256:${'7b42'.padEnd(60, '0')}91ef`,
    manifest,
    scenarios: [
      {
        scenario_id: 'claim-reversal',
        current_step: 3,
        completed_step: 3,
        total_steps: 3,
        state_version: 3,
        status: 'completed',
        last_error: null,
      },
    ],
  },
};

const overviewResponse = {
  schema_version: '1.0',
  request_id: 'req_overview',
  data: {
    schema_version: '1.0',
    generated_at: '2026-08-25T05:21:00.000Z',
    dataset_timestamp: '2026-08-25T05:20:00.000Z',
    manifest,
    lifecycle_distribution: [
      {
        lifecycle_state: 'open',
        count: 16,
        exposure_amount: { amount_minor: '128000000', currency: 'INR' },
      },
      {
        lifecycle_state: 'reconciled',
        count: 2,
        exposure_amount: { amount_minor: '45500000', currency: 'INR' },
      },
    ],
    opened_closed_trend: [
      { date: '2026-08-24', opened: 8, closed: 1 },
      { date: '2026-08-25', opened: 8, closed: 2 },
    ],
    top_cases: [],
    claim_truth_comparison: {
      claim_id: 'claim_demo',
      external_claim_id: 'demo_claim_reversal',
      claimed_amount: { amount_minor: '12000000', currency: 'INR' },
      recovery_payment_observed: true,
      correlated_refund_amount: { amount_minor: '12000000', currency: 'INR' },
      final_retained_value: { amount_minor: '0', currency: 'INR' },
      verified_incremental_recovery: { amount_minor: '0', currency: 'INR' },
      current_status: 'REVERSED',
      evidence_references: [{ evidence_id: 'evt_capture_demo', evidence_type: 'captured_payment' }],
      route_acknowledgement: null,
      verification_chain: null,
    },
    claim_reversal_summary: {
      reversed_recovery: { amount_minor: '12000000', currency: 'INR' },
      reversed_claims: 1,
    },
  },
};

const casesResponse = {
  schema_version: '1.0',
  request_id: 'req_cases',
  data: {
    items: [
      {
        schema_version: '1.0',
        case_id: 'case_high',
        case_dedupe_key: 'case:high',
        tenant_id: 'ten_demo',
        subject_id: 'subject_high',
        expectation_id: 'expectation_high',
        control_id: 'CTRL-01',
        epoch: 1,
        lifecycle_state: 'open',
        outcome_status: 'DIVERGED',
        exposure: { amount_minor: '8000000', currency: 'INR' },
        priority_score: 0.9,
        evidence_coverage: 'partial',
        contradiction_count: 0,
        owner_id: 'user_investigator',
        opened_at: '2026-08-23T05:20:00.000Z',
        due_at: null,
        closed_at: null,
        resource_version: 1,
      },
    ],
    page_info: { next_cursor: null, has_more: false },
  },
};

const healthResponse = {
  schema_version: '1.0',
  request_id: 'req_health',
  data: {
    schema_version: '1.0',
    generated_at: '2026-08-25T05:20:00.000Z',
    model_mode: 'stub',
    database: 'up',
    worker: 'up',
    sources: [],
    received_total: 500,
    duplicate_total: 0,
    conflict_total: 0,
    schema_failure_total: 0,
    projector_lag_seconds: 0,
    job_lag_seconds: 0,
    pending_verification: 0,
    unlinked: 0,
    candidate_links: 4,
    stale_projections: 0,
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  window.history.replaceState({}, '', '/overview');
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('crypto', { randomUUID: () => 'client-request-id' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path.includes('/v1/overview')) return jsonResponse(overviewResponse);
      if (path.includes('/v1/cases')) return jsonResponse(casesResponse);
      if (path.includes('/v1/data-health')) return jsonResponse(healthResponse);
      return jsonResponse(statusResponse);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Revenue Integrity Overview', () => {
  it('renders authoritative claim truth, all six KPIs, summaries, and prioritized cases', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Revenue Integrity Overview' }),
    ).toBeVisible();
    expect(screen.getByText('Claim reversal · step 3 of 3 completed')).toBeVisible();
    expect(screen.getByText('Outcome · REVERSED — not verified')).toBeVisible();
    expect(screen.getByText('-₹1,20,000.00 INR · authoritative refund')).toBeVisible();
    for (const title of [
      'Unresolved exposure',
      'Verified restored',
      'Duplicate collection prevented',
      'Matched records',
      'Unresolved material cases',
      'Unsafe candidate matches blocked',
    ]) {
      expect(screen.getByText(title)).toBeVisible();
    }
    expect(screen.getByRole('heading', { name: 'Exposure by lifecycle state' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Case resolution distribution' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Opened versus closed cases' })).toBeVisible();
    const caseSection = screen
      .getByRole('heading', { name: 'Highest material unresolved cases' })
      .closest('section');
    expect(caseSection).not.toBeNull();
    expect((await within(caseSection!).findAllByText('case_high')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'How to read this page' }));
    expect(screen.getByText(/never netted together in the browser/i)).toBeVisible();
    await user.click(screen.getByRole('button', { name: /View claim evidence/i }));
    expect(screen.getByText('evt_capture_demo')).toBeVisible();
  });

  it('renders a Route acknowledgement and verification chain when the backend reports them', async () => {
    const remediationOverview = {
      ...overviewResponse,
      data: {
        ...overviewResponse.data,
        claim_truth_comparison: {
          claim_id: 'claim_remediation_demo',
          external_claim_id: 'demo_missing_transfer_remediation',
          claimed_amount: { amount_minor: '45500000', currency: 'INR' },
          recovery_payment_observed: true,
          correlated_refund_amount: { amount_minor: '0', currency: 'INR' },
          final_retained_value: { amount_minor: '4500000', currency: 'INR' },
          verified_incremental_recovery: { amount_minor: '4500000', currency: 'INR' },
          current_status: 'PARTIALLY_VERIFIED',
          evidence_references: [
            { evidence_id: 'evt_capture_remediation', evidence_type: 'captured_payment' },
          ],
          route_acknowledgement: {
            acknowledged: true,
            source_system: 'SYNTHETIC_ROUTE',
            occurred_at: '2026-08-25T05:00:00.000Z',
          },
          verification_chain: [
            {
              step: 'bank_evidence',
              label: 'Independent bank evidence received',
              satisfied: true,
              occurred_at: '2026-08-25T05:10:00.000Z',
            },
            {
              step: 'unique_allocation',
              label: 'Unique allocation — no double counting',
              satisfied: true,
              occurred_at: '2026-08-25T05:12:00.000Z',
            },
            {
              step: 'erp_closure',
              label: 'ERP closure recorded',
              satisfied: false,
              occurred_at: null,
            },
          ],
        },
      },
    };
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const path = String(input);
      if (path.includes('/v1/overview')) return jsonResponse(remediationOverview);
      if (path.includes('/v1/cases')) return jsonResponse(casesResponse);
      if (path.includes('/v1/data-health')) return jsonResponse(healthResponse);
      return jsonResponse(statusResponse);
    });
    render(<App />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Revenue Integrity Overview' }),
    ).toBeVisible();
    expect(screen.getByText('Acknowledged — not verification')).toBeVisible();
    expect(screen.getByText('Verification chain — all three required')).toBeVisible();
    expect(screen.getByText('Independent bank evidence received')).toBeVisible();
    expect(screen.getByText('Unique allocation — no double counting')).toBeVisible();
    expect(screen.getByText('ERP closure recorded')).toBeVisible();
    expect(screen.getByText('Outcome · PARTIALLY_VERIFIED')).toBeVisible();
  });

  it('distinguishes a missing dataset and exposes the operator controller action', async () => {
    const user = userEvent.setup();
    const noDatasetStatus = {
      ...statusResponse,
      data: {
        ...statusResponse.data,
        ready: false,
        seed_id: null,
        manifest_hash: null,
        manifest: null,
      },
    };
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const path = String(input);
      if (path.includes('/v1/data-health')) return jsonResponse(healthResponse);
      if (path.includes('/v1/demo/status')) return jsonResponse(noDatasetStatus);
      return jsonResponse(overviewResponse);
    });
    render(<App />);
    await user.click(screen.getAllByRole('button', { name: /Demo role/i })[0]!);
    await user.click(await screen.findByRole('menuitemradio', { name: /Demo Operator/i }));
    expect(
      await screen.findByRole('heading', { name: 'The synthetic dataset is not ready.' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open demo controller' }));
    expect(await screen.findByRole('dialog', { name: 'Demo scenario controller' })).toBeVisible();
  });

  it('distinguishes zero unresolved exposure from a missing dataset', async () => {
    const noExposureOverview = {
      ...overviewResponse,
      data: {
        ...overviewResponse.data,
        manifest: {
          ...overviewResponse.data.manifest,
          unresolved_cases: 0,
          unresolved_exposure: '0',
        },
      },
    };
    const noCases = {
      ...casesResponse,
      data: { items: [], page_info: { next_cursor: null, has_more: false } },
    };
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const path = String(input);
      if (path.includes('/v1/overview')) return jsonResponse(noExposureOverview);
      if (path.includes('/v1/cases')) return jsonResponse(noCases);
      if (path.includes('/v1/data-health')) return jsonResponse(healthResponse);
      return jsonResponse(statusResponse);
    });
    render(<App />);
    expect(await screen.findByText('No unresolved exposure in the current dataset.')).toBeVisible();
    expect(screen.queryByText('The synthetic dataset is not ready.')).not.toBeInTheDocument();
  });

  it('keeps the overview visible when only the prioritized case request fails', async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL | Request) => {
      const path = String(input);
      if (path.includes('/v1/overview')) return jsonResponse(overviewResponse);
      if (path.includes('/v1/cases')) {
        return jsonResponse(
          {
            schema_version: '1.0',
            error: {
              code: 'SOURCE_UNAVAILABLE',
              message: 'case projection unavailable',
              request_id: 'req_cases_failed',
              retryable: true,
              details: { kind: 'none' },
            },
          },
          503,
        );
      }
      if (path.includes('/v1/data-health')) return jsonResponse(healthResponse);
      return jsonResponse(statusResponse);
    });
    render(<App />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Revenue Integrity Overview' }),
    ).toBeVisible();
    expect(await screen.findByText(/Request ID req_cases_failed/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry cases' })).toBeVisible();
  });

  it('has no automated accessibility violations in the stable overview', async () => {
    const { container } = render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Revenue Integrity Overview' });
    await screen.findAllByText('case_high');
    const result = await axe(container);
    expect(result.violations, JSON.stringify(result.violations, null, 2)).toHaveLength(0);
  });
});
