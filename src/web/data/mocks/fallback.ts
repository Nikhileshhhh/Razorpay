import { ApiError } from '../client.js';

/**
 * Frontend-only phase: every fetcher tries the real API first and only falls
 * back to the designed mock content when the API is genuinely unreachable
 * (`NETWORK_ERROR` — no server running). Any real response, including a real
 * error status from a running backend, is passed through unchanged, so this
 * becomes a no-op the moment the backend is connected.
 */
export async function withMockFallback<T>(fetcher: () => Promise<T>, mock: T): Promise<T> {
  try {
    return await fetcher();
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NETWORK_ERROR') return mock;
    throw error;
  }
}
