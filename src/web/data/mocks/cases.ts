import type { z } from 'zod';
import type { CaseLifecycleState, EvidenceCoverage } from '../../../contracts/index.js';
import { CaseListResponse } from '../../../contracts/index.js';
import type { CaseSummary } from '../../../contracts/index.js';

type CaseListResponse = z.infer<typeof CaseListResponse>;

/**
 * Offline fixture for the Case Queue, reproducing the eight cases shown in the
 * Case Queue design PNG (designs/design png/case queue UI images/
 * MoneyTrace Case Queue-selection.png) plus low-exposure filler rows so the
 * total reads "21 current results" and the first page is exactly the eight
 * design rows. Free-text columns that vary per case even within one control id
 * (expected / divergence / policy / nextAction) live in {@link CASE_DISPLAY}
 * below, since `CaseSummary` is a strict contract type with no display fields.
 */
function summary(
  overrides: Pick<
    CaseSummary,
    | 'case_id'
    | 'control_id'
    | 'lifecycle_state'
    | 'outcome_status'
    | 'exposure'
    | 'evidence_coverage'
    | 'contradiction_count'
    | 'owner_id'
    | 'opened_at'
    | 'resource_version'
  > &
    Partial<CaseSummary>,
): CaseSummary {
  return {
    schema_version: '1.0',
    case_dedupe_key: `dedupe:${overrides.case_id}`,
    tenant_id: 'ten_demo',
    subject_id: `subj_${overrides.case_id.toLowerCase()}`,
    expectation_id: `exp_${overrides.case_id.toLowerCase()}`,
    epoch: 1,
    priority_score: 0.5,
    due_at: null,
    closed_at: null,
    ...overrides,
  };
}

/** Per-case display text for the four free-text queue columns (from the PNG).
 * `policyStatus` mirrors the real `PolicyDecision` enum
 * (src/contracts/policy.ts) so the POLICY STATUS filter is genuinely
 * functional against the fixture. */
export interface CaseDisplayMeta {
  readonly expected: string;
  readonly divergence: string;
  readonly policy: string;
  readonly policyTone: 'danger' | 'warning' | 'success' | 'neutral';
  readonly policyStatus:
    'ALLOW_AUTOMATIC' | 'REQUIRE_APPROVAL' | 'ADVISE' | 'DENY' | 'REQUIRE_MORE_EVIDENCE';
  readonly nextAction: string;
}

export const CASE_DISPLAY: Readonly<Record<string, CaseDisplayMeta>> = {
  'CASE-2043': {
    expected: 'Refund correlated to capture',
    divergence: 'Conflicting bank evidence',
    policy: 'Automatic closure blocked',
    policyTone: 'danger',
    policyStatus: 'DENY',
    nextAction: 'Review approval',
  },
  'CASE-2077': {
    expected: 'Transfer observed at payout',
    divergence: 'Transfer not observed',
    policy: 'Awaiting bank evidence',
    policyTone: 'warning',
    policyStatus: 'REQUIRE_MORE_EVIDENCE',
    nextAction: 'Check status',
  },
  'CASE-2031': {
    expected: 'Single collection per invoice',
    divergence: 'Duplicate collection candidate',
    policy: 'Duplicate candidate held',
    policyTone: 'neutral',
    policyStatus: 'REQUIRE_APPROVAL',
    nextAction: 'Run investigation',
  },
  'CASE-2018': {
    expected: 'Refund correlated to capture',
    divergence: 'Refund correlation divergence',
    policy: 'Automatic closure blocked',
    policyTone: 'danger',
    policyStatus: 'DENY',
    nextAction: 'Request more evidence',
  },
  'CASE-2062': {
    expected: 'Unique match or abstain',
    divergence: 'Unsafe candidate match',
    policy: 'Matcher abstained',
    policyTone: 'neutral',
    policyStatus: 'ADVISE',
    nextAction: 'Request more evidence',
  },
  'CASE-2054': {
    expected: 'Single collection per invoice',
    divergence: 'Replayed collection request',
    policy: 'Duplicate prevented',
    policyTone: 'success',
    policyStatus: 'ALLOW_AUTOMATIC',
    nextAction: 'No action — replay-safe',
  },
  'CASE-2090': {
    expected: 'Retained recovery value',
    divergence: 'Agent claim not retained',
    policy: 'Reversal recorded',
    policyTone: 'neutral',
    policyStatus: 'ALLOW_AUTOMATIC',
    nextAction: 'Check status',
  },
  'CASE-2011': {
    expected: 'Transfer observed at payout',
    divergence: 'Transfer not observed',
    policy: 'Closed with evidence',
    policyTone: 'success',
    policyStatus: 'ALLOW_AUTOMATIC',
    nextAction: 'No action required',
  },
};

export function caseDisplay(row: CaseSummary): CaseDisplayMeta {
  return (
    CASE_DISPLAY[row.case_id] ?? {
      expected: '—',
      divergence: 'Registered control divergence',
      policy: 'Under review',
      policyTone: 'neutral',
      policyStatus: 'ADVISE',
      nextAction: 'Request bank evidence',
    }
  );
}

export const MOCK_CASES: readonly CaseSummary[] = [
  summary({
    case_id: 'CASE-2043',
    control_id: 'CTL-11',
    lifecycle_state: 'approval_required',
    outcome_status: 'UNRESOLVED',
    exposure: { amount_minor: '64000000', currency: 'INR' },
    evidence_coverage: 'complete',
    contradiction_count: 3,
    owner_id: null,
    opened_at: '2026-08-16T00:00:00Z',
    resource_version: 5,
    priority_score: 0.95,
  }),
  summary({
    case_id: 'CASE-2077',
    control_id: 'CTL-04',
    lifecycle_state: 'verification_pending',
    outcome_status: 'ACTION_PENDING',
    exposure: { amount_minor: '45500000', currency: 'INR' },
    evidence_coverage: 'partial',
    contradiction_count: 0,
    owner_id: 'S. Menon',
    opened_at: '2026-08-22T00:00:00Z',
    due_at: '2026-08-26T12:30:00Z',
    resource_version: 7,
    priority_score: 0.9,
  }),
  summary({
    case_id: 'CASE-2031',
    control_id: 'CTL-02',
    lifecycle_state: 'investigating',
    outcome_status: 'DIVERGED',
    exposure: { amount_minor: '32000000', currency: 'INR' },
    evidence_coverage: 'insufficient',
    contradiction_count: 1,
    owner_id: 'A. Rao',
    opened_at: '2026-08-21T00:00:00Z',
    resource_version: 3,
    priority_score: 0.8,
  }),
  summary({
    case_id: 'CASE-2018',
    control_id: 'CTL-11',
    lifecycle_state: 'open',
    outcome_status: 'UNRESOLVED',
    exposure: { amount_minor: '16000000', currency: 'INR' },
    evidence_coverage: 'partial',
    contradiction_count: 2,
    owner_id: null,
    opened_at: '2026-08-16T00:00:00Z',
    resource_version: 2,
    priority_score: 0.7,
  }),
  summary({
    case_id: 'CASE-2062',
    control_id: 'CTL-09',
    lifecycle_state: 'abstained',
    outcome_status: 'UNRESOLVED',
    exposure: { amount_minor: '8000000', currency: 'INR' },
    evidence_coverage: 'insufficient',
    contradiction_count: 0,
    owner_id: 'K. Iyer',
    opened_at: '2026-08-23T00:00:00Z',
    resource_version: 1,
    priority_score: 0.4,
  }),
  summary({
    case_id: 'CASE-2054',
    control_id: 'CTL-02',
    lifecycle_state: 'reconciled',
    outcome_status: 'VERIFIED',
    exposure: { amount_minor: '8000000', currency: 'INR' },
    evidence_coverage: 'complete',
    contradiction_count: 0,
    owner_id: 'P. Shah',
    opened_at: '2026-08-20T00:00:00Z',
    resource_version: 4,
    priority_score: 0.2,
  }),
  summary({
    case_id: 'CASE-2090',
    control_id: 'CTL-11',
    lifecycle_state: 'reconciled',
    outcome_status: 'REVERSED',
    exposure: { amount_minor: '0', currency: 'INR' },
    evidence_coverage: 'complete',
    contradiction_count: 1,
    owner_id: 'A. Rao',
    opened_at: '2026-08-24T00:00:00Z',
    resource_version: 2,
    priority_score: 0.1,
  }),
  summary({
    case_id: 'CASE-2011',
    control_id: 'CTL-04',
    lifecycle_state: 'reconciled',
    outcome_status: 'VERIFIED',
    exposure: { amount_minor: '0', currency: 'INR' },
    evidence_coverage: 'complete',
    contradiction_count: 0,
    owner_id: 'S. Menon',
    opened_at: '2026-08-18T00:00:00Z',
    resource_version: 3,
    priority_score: 0.05,
  }),
  // Zero-exposure filler so the dataset totals 21 without disturbing the
  // exposure-descending order: every filler row must sort at or below the two
  // ₹0 design rows above (CASE-2090, CASE-2011), which the stable sort keeps
  // ahead of same-value filler because they appear earlier in this array —
  // so the first page is always exactly the eight design rows.
  ...(
    [
      ['CASE-2005', 'CTL-02', 'reconciled', 'VERIFIED', '0', 'complete', 0, 'P. Shah'],
      ['CASE-2009', 'CTL-04', 'closed_no_action', 'VERIFIED', '0', 'complete', 0, 'K. Iyer'],
      ['CASE-2014', 'CTL-11', 'candidate', 'EXPECTED', '0', 'insufficient', 0, null],
      ['CASE-2022', 'CTL-02', 'reconciled', 'VERIFIED', '0', 'complete', 0, 'A. Rao'],
      ['CASE-2026', 'CTL-09', 'rejected', 'UNRESOLVED', '0', 'partial', 0, 'S. Menon'],
      ['CASE-2035', 'CTL-04', 'investigating', 'DIVERGED', '0', 'partial', 0, 'A. Rao'],
      ['CASE-2038', 'CTL-11', 'closed_no_action', 'VERIFIED', '0', 'complete', 0, 'P. Shah'],
      ['CASE-2047', 'CTL-02', 'reconciled', 'VERIFIED', '0', 'complete', 0, 'K. Iyer'],
      ['CASE-2051', 'CTL-04', 'expired', 'UNRESOLVED', '0', 'insufficient', 1, null],
      ['CASE-2058', 'CTL-11', 'reconciled', 'VERIFIED', '0', 'complete', 0, 'S. Menon'],
      ['CASE-2065', 'CTL-09', 'candidate', 'EXPECTED', '0', 'insufficient', 0, null],
      ['CASE-2071', 'CTL-02', 'closed_no_action', 'VERIFIED', '0', 'complete', 0, 'A. Rao'],
      ['CASE-2083', 'CTL-04', 'reconciled', 'VERIFIED', '0', 'complete', 0, 'P. Shah'],
    ] as const
  ).map(([case_id, control_id, lifecycle_state, outcome_status, minor, coverage, contra, owner]) =>
    summary({
      case_id,
      control_id,
      lifecycle_state,
      outcome_status,
      exposure: { amount_minor: minor, currency: 'INR' },
      evidence_coverage: coverage,
      contradiction_count: contra,
      owner_id: owner,
      opened_at: '2026-08-15T00:00:00Z',
      resource_version: 1,
      priority_score: 0.05,
    }),
  ),
] as const;

/** Query shape mirrored from `ListCasesQuery` (src/contracts/api-endpoints.ts),
 * used to filter/sort/paginate {@link MOCK_CASES} client-side so the Case
 * Queue page's URL-backed filters genuinely work with no backend running. */
export interface MockCaseQuery {
  readonly q?: string;
  readonly state?: readonly CaseLifecycleState[];
  readonly control_id?: string;
  readonly evidence_coverage?: EvidenceCoverage;
  readonly owner_id?: string;
  readonly min_exposure_minor?: string;
  readonly max_exposure_minor?: string;
  readonly sort?: '-exposure_amount_minor' | 'exposure_amount_minor' | '-opened_at' | 'opened_at';
  readonly cursor?: string;
  readonly limit?: number;
}

const PAGE_SIZE = 8;

function filterMockCases(query: MockCaseQuery): readonly CaseSummary[] {
  return MOCK_CASES.filter((row) => {
    if (query.q && !row.case_id.toLowerCase().includes(query.q.toLowerCase())) return false;
    if (query.state && query.state.length > 0 && !query.state.includes(row.lifecycle_state)) {
      return false;
    }
    if (query.control_id && row.control_id !== query.control_id) return false;
    if (query.evidence_coverage && row.evidence_coverage !== query.evidence_coverage) return false;
    if (query.owner_id === 'unassigned' && row.owner_id !== null) return false;
    if (query.owner_id && query.owner_id !== 'unassigned' && row.owner_id !== query.owner_id) {
      return false;
    }
    if (
      query.min_exposure_minor &&
      BigInt(row.exposure.amount_minor) < BigInt(query.min_exposure_minor)
    ) {
      return false;
    }
    if (
      query.max_exposure_minor &&
      BigInt(row.exposure.amount_minor) > BigInt(query.max_exposure_minor)
    ) {
      return false;
    }
    return true;
  });
}

function sortMockCases(
  rows: readonly CaseSummary[],
  sort: MockCaseQuery['sort'],
): readonly CaseSummary[] {
  // Stable sort (returns 0 on ties) so the fixture order is preserved for equal
  // keys — keeps the two ₹0 design rows ahead of the ₹0 filler on page one.
  return [...rows].sort((left, right) => {
    switch (sort) {
      case 'exposure_amount_minor': {
        const l = BigInt(left.exposure.amount_minor);
        const r = BigInt(right.exposure.amount_minor);
        return l < r ? -1 : l > r ? 1 : 0;
      }
      case 'opened_at':
        return left.opened_at.localeCompare(right.opened_at);
      case '-opened_at':
        return right.opened_at.localeCompare(left.opened_at);
      case '-exposure_amount_minor':
      default: {
        const l = BigInt(left.exposure.amount_minor);
        const r = BigInt(right.exposure.amount_minor);
        return r < l ? -1 : r > l ? 1 : 0;
      }
    }
  });
}

export function queryMockCases(query: MockCaseQuery): CaseListResponse {
  const rows = sortMockCases(filterMockCases(query), query.sort);
  const total = rows.length;
  const limit = query.limit ?? PAGE_SIZE;
  const start = query.cursor ? Number.parseInt(query.cursor, 10) : 0;
  const page = rows.slice(start, start + limit);
  const nextIndex = start + limit;
  return mockCaseListResponse(page, {
    next_cursor: nextIndex < total ? String(nextIndex) : null,
    has_more: nextIndex < total,
  });
}

/** Total number of cases matching a query, ignoring pagination (for the
 * "N current results" header and "Showing X–Y of N" footer). */
export function countMockCases(query: MockCaseQuery): number {
  return filterMockCases(query).length;
}

export function mockCaseListResponse(
  items: readonly CaseSummary[],
  pageInfo: { next_cursor: string | null; has_more: boolean } = {
    next_cursor: null,
    has_more: false,
  },
): CaseListResponse {
  return {
    schema_version: '1.0',
    request_id: 'req_mock_cases',
    data: { items: [...items], page_info: pageInfo },
  };
}

/** Hardcoded top-3-by-exposure preview matching the Overview design's
 * "Highest material unresolved cases" table exactly (control ids recognized
 * by OverviewPage's own CONTROL_LABELS dictionary). */
export const MOCK_OVERVIEW_TOP_CASES: readonly CaseSummary[] = [
  summary({
    case_id: 'CASE-2043',
    control_id: 'CTRL-01',
    lifecycle_state: 'open',
    outcome_status: 'DIVERGED',
    exposure: { amount_minor: '64000000', currency: 'INR' },
    evidence_coverage: 'partial',
    contradiction_count: 2,
    owner_id: 'A. Rao',
    opened_at: '2026-08-19T00:00:00Z',
    resource_version: 5,
    priority_score: 0.95,
  }),
  summary({
    case_id: 'CASE-2031',
    control_id: 'CTRL-04',
    lifecycle_state: 'investigating',
    outcome_status: 'DIVERGED',
    exposure: { amount_minor: '32000000', currency: 'INR' },
    evidence_coverage: 'insufficient',
    contradiction_count: 0,
    owner_id: 'S. Menon',
    opened_at: '2026-08-21T00:00:00Z',
    resource_version: 3,
    priority_score: 0.8,
  }),
  summary({
    case_id: 'CASE-2018',
    control_id: 'CTRL-05',
    lifecycle_state: 'escalated',
    outcome_status: 'UNRESOLVED',
    exposure: { amount_minor: '16000000', currency: 'INR' },
    evidence_coverage: 'complete',
    contradiction_count: 3,
    owner_id: null,
    opened_at: '2026-08-16T00:00:00Z',
    resource_version: 2,
    priority_score: 0.7,
  }),
];
