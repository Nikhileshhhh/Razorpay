import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { loadEnv } from '../../src/config/env.js';

/**
 * The health route boots the Fastify app WITHOUT opening any database
 * connection, and validates its own response against the Zod contract.
 * Uses app.inject (no real socket) so the test is hermetic.
 */
describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const env = loadEnv({
      MONEYTRACE_ENV: 'demo',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    });
    app = buildServer(env);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns a schema-valid health payload', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      status: 'ok',
      service: 'moneytrace',
      environment: 'demo',
    });
    expect(typeof body.time).toBe('string');
  });
});
