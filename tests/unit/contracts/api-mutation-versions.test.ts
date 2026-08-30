import { describe, expect, it } from 'vitest';
import { API_ROUTES } from '../../../src/contracts/registry.js';
import { buildOpenApiDocument } from '../../../src/contracts/openapi.js';

const toOpenApiPath = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
const is2xx = (s: number) => s >= 200 && s < 300;

const postRoutes = API_ROUTES.filter((r) => r.method === 'post');

describe('every POST success returns a resulting resource version (finding 4)', () => {
  it('there are POST routes to check', () => {
    expect(postRoutes.length).toBeGreaterThan(10);
  });

  it('registry: every POST 2xx response is a versioned mutation response', () => {
    for (const route of postRoutes) {
      const success = route.responses.filter((r) => is2xx(r.status));
      expect(success.length, `no 2xx for ${route.path}`).toBeGreaterThan(0);
      for (const r of success) {
        expect(r.kind, `${route.method} ${route.path} ${r.status}`).toBe('mutation');
      }
    }
  });

  it('openapi: every POST 2xx response schema declares resource_version', () => {
    const doc = buildOpenApiDocument();
    for (const route of postRoutes) {
      const path = toOpenApiPath(route.path);
      const op = (doc.paths?.[path] as Record<string, { responses?: Record<string, unknown> }>)
        ?.post;
      expect(op, `missing path ${path}`).toBeDefined();
      for (const [status, resp] of Object.entries(op?.responses ?? {})) {
        if (!is2xx(Number(status))) continue;
        const schema = (resp as { content?: Record<string, { schema?: { properties?: object } }> })
          .content?.['application/json']?.schema;
        expect(
          (schema?.properties as Record<string, unknown> | undefined)?.resource_version,
          `${path} ${status} missing resource_version`,
        ).toBeDefined();
      }
    }
  });
});
