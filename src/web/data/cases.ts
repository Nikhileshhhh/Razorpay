import { CaseListResponse } from '../../contracts/index.js';
import type { CaseLifecycleState, EvidenceCoverage } from '../../contracts/index.js';
import { apiRequest } from './client.js';
import { countMockCases, queryMockCases, type MockCaseQuery } from './mocks/cases.js';
import { withMockFallback } from './mocks/fallback.js';

/**
 * Design-fidelity pass (Cases pages): render the exact fixture from the PNG
 * designs regardless of whether a backend happens to be reachable, so layout,
 * copy and the specific case set always match
 * `designs/design png/case queue UI images/`. Flip to `false` once the real
 * `/v1/cases` read model is ready to be the source of truth again — every
 * fetcher below already has the live-request path wired via
 * `withMockFallback`, so this is the only line that needs to change.
 */
const DESIGN_FIXTURE_MODE = true;

export interface CaseQueueQuery {
  readonly q?: string;
  readonly state?: readonly CaseLifecycleState[];
  readonly control_id?: string;
  readonly evidence_coverage?: EvidenceCoverage;
  readonly owner_id?: string;
  readonly min_exposure_minor?: string;
  readonly max_exposure_minor?: string;
  readonly sort?: '-exposure_amount_minor' | 'exposure_amount_minor' | '-opened_at' | 'opened_at';
  readonly cursor?: string;
}

export const caseQueueQueryKey = (userId: string, query: CaseQueueQuery) =>
  ['cases', userId, 'queue', query] as const;

function toSearchParams(query: CaseQueueQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  for (const state of query.state ?? []) params.append('state', state);
  if (query.control_id) params.set('control_id', query.control_id);
  if (query.evidence_coverage) params.set('evidence_coverage', query.evidence_coverage);
  if (query.owner_id) params.set('owner_id', query.owner_id);
  if (query.min_exposure_minor) params.set('min_exposure_minor', query.min_exposure_minor);
  if (query.max_exposure_minor) params.set('max_exposure_minor', query.max_exposure_minor);
  if (query.sort) params.set('sort', query.sort);
  if (query.cursor) params.set('cursor', query.cursor);
  return params;
}

export function getCaseQueue(userId: string, query: CaseQueueQuery, signal?: AbortSignal) {
  const mockQuery: MockCaseQuery = { ...query };
  if (DESIGN_FIXTURE_MODE) return Promise.resolve(queryMockCases(mockQuery));
  const search = toSearchParams(query);
  return withMockFallback(
    () => apiRequest(`/v1/cases?${search.toString()}`, CaseListResponse, { userId, signal }),
    queryMockCases(mockQuery),
  );
}

/**
 * Total count matching a query, ignoring pagination — used for the "N current
 * results" header chip and the "Showing X–Y of N" footer. The real
 * `ListCasesQuery`/`PageInfo` contract has no total field (cursor pagination
 * only exposes `next_cursor`/`has_more`), so this is fixture-only and simply
 * returns the current page length once live mode is restored.
 */
export function getCaseQueueTotal(query: CaseQueueQuery): number {
  if (DESIGN_FIXTURE_MODE) return countMockCases({ ...query });
  return 0;
}

export function isDesignFixtureMode(): boolean {
  return DESIGN_FIXTURE_MODE;
}
