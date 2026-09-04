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

  it('GET /ready is safely not_ready (503) with no DATABASE_URL configured, and never leaks a URL/secret', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.data).toEqual({ status: 'not_ready', database: 'down', worker: 'down' });
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/postgres(ql)?:\/\//i);
    expect(raw.toLowerCase()).not.toContain('secret');
  });

  it('GET /openapi.json serves the generated document (no live DB required)', async () => {
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.openapi).toBe('3.0.3');
    expect(body.paths['/health']).toBeDefined();
  });
});
