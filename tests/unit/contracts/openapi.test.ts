import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../../src/contracts/openapi.js';

/** Exact documented method/path -> status set (architecture §10). */
const EXPECTED_STATUSES: Record<string, number[]> = {
  'post /v1/events': [202, 400, 401, 403, 409, 413, 503],
  'post /v1/webhooks/razorpay': [202, 400, 401, 409, 413, 503],
  'post /v1/imports': [202, 400, 413, 422],
  'get /v1/cases': [200, 400, 403],
  'get /v1/cases/{id}': [200, 403, 404],
  'get /v1/cases/{id}/money-path': [200, 403, 404, 422],
  'get /v1/cases/{id}/evidence': [200, 400, 403, 404],
  'get /v1/cases/{id}/notes': [200, 400, 403, 404],
  'post /v1/cases/{id}/assign': [200, 403, 409, 422],
  'post /v1/cases/{id}/notes': [201, 403, 409, 422],
  'post /v1/cases/{id}/links/{linkId}/decision': [200, 403, 409, 422],
  'post /v1/cases/{id}/investigations': [202, 409, 422, 503],
  'post /v1/cases/{id}/evaluate-policy': [200, 409, 422],
  'post /v1/cases/{id}/request-approval': [200, 409, 422],
  'post /v1/cases/{id}/approve': [200, 403, 409, 422],
  'post /v1/cases/{id}/reject': [200, 403, 409, 422],
  'post /v1/cases/{id}/request-more-evidence': [200, 403, 409, 422],
  'get /v1/approvals': [200, 400, 403],
  'get /v1/cases/{id}/control-loop': [200, 403, 404],
  'post /v1/cases/{id}/execute': [202, 403, 409, 422],
  'get /v1/cases/{id}/verification': [200, 403, 404],
  'post /v1/actions/{id}/verification-checks': [200, 409, 422],
  'get /v1/cases/{id}/audit': [200, 403, 404],
  'post /v1/agent-results': [201, 400, 409, 422],
  'get /v1/agent-results/{id}': [200, 403, 404],
  'post /v1/demo/reset': [200, 403, 409],
  'post /v1/demo/scenarios/{id}/advance': [200, 403, 409],
};

function statusMatrix(doc: ReturnType<typeof buildOpenApiDocument>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of ['get', 'post'] as const) {
      const op = (item as Record<string, { responses?: Record<string, unknown> }>)[method];
      if (!op?.responses) continue;
      out[`${method} ${path}`] = Object.keys(op.responses)
        .map(Number)
        .sort((a, b) => a - b);
    }
  }
  return out;
}

describe('OpenAPI document', () => {
  it('is OpenAPI 3.0.3 and no longer says contracts are deferred', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.info.description ?? '').not.toMatch(/deferred|defined in MT-002|Scaffold only/i);
  });

  it('matches the exact documented method/path/status matrix', () => {
    const matrix = statusMatrix(buildOpenApiDocument());
    delete matrix['get /health'];
    const expected = Object.fromEntries(
      Object.entries(EXPECTED_STATUSES).map(([k, v]) => [k, [...v].sort((a, b) => a - b)]),
    );
    expect(matrix).toEqual(expected);
  });

  it('describes monetary fields as decimal strings (never numbers)', () => {
    const doc = buildOpenApiDocument();
    const money = (doc.components?.schemas?.Money ?? {}) as {
      properties?: { amount_minor?: { type?: string }; currency?: { enum?: string[] } };
    };
    expect(money.properties?.amount_minor?.type).toBe('string');
    expect(money.properties?.currency?.enum).toEqual(['INR']);
  });

  it('documents the raw webhook body as type string / format binary', () => {
    const doc = buildOpenApiDocument();
    const post = (
      doc.paths?.['/v1/webhooks/razorpay'] as {
        post?: {
          requestBody?: {
            content?: Record<string, { schema?: { type?: string; format?: string } }>;
          };
        };
      }
    )?.post;
    const schema = post?.requestBody?.content?.['application/json']?.schema;
    expect(schema?.type).toBe('string');
    expect(schema?.format).toBe('binary');
  });

  it('is normalized with $ref reuse (no giant inline duplication)', () => {
    const doc = buildOpenApiDocument();
    const json = JSON.stringify(doc);
    const refCount = json.split('"$ref"').length - 1;
    expect(refCount).toBeGreaterThan(50);
    expect(json.length).toBeLessThan(300_000);
  });

  it('is generated deterministically', () => {
    expect(buildOpenApiDocument()).toEqual(buildOpenApiDocument());
  });
});

describe('OpenAPI stable snapshots (reviewable)', () => {
  it('path/method/status manifest', () => {
    const matrix = statusMatrix(buildOpenApiDocument());
    const manifest = Object.keys(matrix)
      .sort()
      .map((k) => `${k} -> [${matrix[k]?.join(', ')}]`);
    expect(manifest).toMatchSnapshot();
  });

  it('named component inventory', () => {
    const doc = buildOpenApiDocument();
    expect(Object.keys(doc.components?.schemas ?? {}).sort()).toMatchSnapshot();
  });

  it('critical component schemas', () => {
    const doc = buildOpenApiDocument();
    const schemas = doc.components?.schemas ?? {};
    for (const name of [
      'CanonicalEvent',
      'ErrorEnvelope',
      'ModelInvestigationOutput',
      'Plan',
      'ReconciliationResult',
      'SourceAuthorityRecord',
      'RegisteredToolRequest',
      'RegisteredToolResult',
      'ApprovalDecisionBasis',
      'ApprovalRecord',
      'ActionRecord',
      'VerificationContract',
      'ClaimEvaluation',
      'ClaimAccepted',
    ]) {
      expect(schemas[name], `missing critical component ${name}`).toBeDefined();
      expect(schemas[name]).toMatchSnapshot(name);
    }
  });
});
