import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoStatusResponse } from '../../../src/contracts/index.js';
import { apiRequest } from '../../../src/web/data/client.js';

const validStatus = {
  schema_version: '1.0',
  request_id: 'req_api_client',
  data: {
    schema_version: '1.0',
    seed_id: null,
    ready: false,
    fixed_clock: '2026-08-25T05:20:00.000Z',
    manifest_hash: null,
    manifest: null,
    scenarios: [],
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('browser API client', () => {
  it('sends the selected demo identity and validates a successful envelope', async () => {
    const fetchMock = vi.fn(async (_path: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        'x-demo-user-id': 'user_viewer',
        'x-request-id': 'client-request-id',
      });
      return new Response(JSON.stringify(validStatus), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('crypto', { randomUUID: () => 'client-request-id' });
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiRequest('/v1/demo/status', DemoStatusResponse, {
      userId: 'user_viewer',
    });

    expect(result.data.ready).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('exposes only the typed safe error envelope', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'client-request-id' });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              schema_version: '1.0',
              error: {
                code: 'POLICY_DENIED',
                message: 'demo role is not permitted',
                request_id: 'req_denied',
                retryable: false,
                details: { kind: 'none' },
              },
            }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    await expect(
      apiRequest('/v1/demo/status', DemoStatusResponse, { userId: 'user_viewer' }),
    ).rejects.toMatchObject({
      code: 'POLICY_DENIED',
      requestId: 'req_denied',
      retryable: false,
      status: 403,
    });
  });

  it('rejects an unrecognized success shape', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'client-request-id' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })),
    );

    await expect(
      apiRequest('/v1/demo/status', DemoStatusResponse, { userId: 'user_viewer' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_RESPONSE' });
  });
});
