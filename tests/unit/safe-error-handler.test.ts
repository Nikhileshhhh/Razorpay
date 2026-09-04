import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { installSafeErrorHandler } from '../../src/api/safe-error-handler.js';

describe('global safe Fastify error handler', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('never returns or logs raw unexpected-error details', async () => {
    let logs = '';
    app = Fastify({
      logger: {
        level: 'error',
        stream: { write: (chunk: string) => void (logs += chunk) },
      },
    });
    installSafeErrorHandler(app);
    app.get('/unexpected', async () => {
      throw new Error('TEST_ONLY_SECRET_MARKER provider://credential@host/private-payload');
    });
    const response = await app.inject({ method: 'GET', url: '/unexpected' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      schema_version: '1.0',
      error: {
        code: 'SOURCE_UNAVAILABLE',
        retryable: true,
        details: { kind: 'none' },
      },
    });
    expect(response.body).not.toContain('TEST_ONLY_SECRET_MARKER');
    expect(response.body).not.toContain('credential@host');
    expect(logs).not.toContain('TEST_ONLY_SECRET_MARKER');
    expect(logs).not.toContain('credential@host');
  });
});
