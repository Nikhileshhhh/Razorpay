import { CaseListResponse, OverviewResponse } from '../../contracts/index.js';
import { apiRequest } from './client.js';
import { mockCaseListResponse, MOCK_OVERVIEW_TOP_CASES } from './mocks/cases.js';
import { withMockFallback } from './mocks/fallback.js';
import { buildOverviewResponse, overlayOverviewResponse } from './mocks/overview.js';

export const overviewQueryKey = (userId: string) => ['overview', userId] as const;
export const overviewCasesQueryKey = (userId: string) =>
  ['cases', userId, 'overview', 'open', '-exposure_amount_minor', 3] as const;

/**
 * Reads the live `/v1/overview` (falling back to the designed fixture when no
 * backend is running), then applies the demo overlay: when the persisted
 * dataset is at baseline (no agent claim yet), the agent-claim panel and KPIs
 * are filled in from the shared client scenario state so the Demo Controller
 * drives them with no backend writes. See `overlayOverviewResponse`.
 */
export function getOverview(userId: string, signal?: AbortSignal) {
  return withMockFallback(
    () => apiRequest('/v1/overview', OverviewResponse, { userId, signal }),
    buildOverviewResponse(),
  ).then(overlayOverviewResponse);
}

export function getOverviewCases(userId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({
    state: 'open',
    sort: '-exposure_amount_minor',
    limit: '3',
  });
  return withMockFallback(
    () => apiRequest(`/v1/cases?${query.toString()}`, CaseListResponse, { userId, signal }),
    mockCaseListResponse(MOCK_OVERVIEW_TOP_CASES),
  );
}
