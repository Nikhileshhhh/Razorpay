import { DataHealthResponse, DemoStatusResponse } from '../../contracts/index.js';
import { apiRequest } from './client.js';
import { MOCK_DATA_HEALTH_RESPONSE } from './mocks/data-health.js';
import { buildDemoStatusResponse, overlayDemoStatus } from './mocks/demo-status.js';
import { withMockFallback } from './mocks/fallback.js';

export const demoStatusQueryKey = (userId: string) => ['demo-status', userId] as const;
export const dataHealthQueryKey = (userId: string) => ['data-health', userId] as const;

/**
 * Reads the live `/v1/demo/status` (falling back to the designed fixture when no
 * backend is running), then overlays the shared client scenario state when the
 * backend is at baseline, so the Demo Controller's advances show up in the
 * drawer and the Overview stage chip. See `overlayDemoStatus`.
 */
export function getDemoStatus(userId: string, signal?: AbortSignal) {
  return withMockFallback(
    () => apiRequest('/v1/demo/status', DemoStatusResponse, { userId, signal }),
    buildDemoStatusResponse(),
  ).then((response) => overlayDemoStatus(response));
}

export function getDataHealth(userId: string, signal?: AbortSignal) {
  return withMockFallback(
    () => apiRequest('/v1/data-health', DataHealthResponse, { userId, signal }),
    MOCK_DATA_HEALTH_RESPONSE,
  );
}
