import { describe, expect, it } from 'vitest';
import { HealthResponse } from '../../src/contracts/health.js';
import { buildOpenApiDocument } from '../../src/contracts/openapi.js';

describe('contracts', () => {
  it('validates a well-formed health response', () => {
    const parsed = HealthResponse.parse({
      status: 'ok',
      service: 'moneytrace',
      environment: 'demo',
      time: new Date().toISOString(),
    });
    expect(parsed.status).toBe('ok');
  });

  it('rejects a malformed health response', () => {
    expect(() => HealthResponse.parse({ status: 'down' })).toThrow();
  });

  it('generates an OpenAPI v3 document from Zod contracts', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.info.title).toBe('MoneyTrace API');
    expect(doc.paths?.['/health']).toBeDefined();
  });
});
