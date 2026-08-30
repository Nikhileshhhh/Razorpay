import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../../src/contracts/openapi.js';
import { COMPONENTS } from '../../../src/contracts/registry.js';

/**
 * The public contract inventory must not expose secret- or PII-bearing fields.
 * Only an opaque `raw_payload_ref` is permitted (never a raw payload/body). We
 * walk every property name in the generated OpenAPI components and assert none
 * match a forbidden pattern.
 */
const FORBIDDEN = [
  /password/i,
  /secret/i,
  /authorization/i,
  /\bcredential/i,
  /api[_-]?key/i,
  /\bcvv\b/i,
  /\bpan\b/i,
  /\bssn\b/i,
  /card[_-]?number/i,
  /bank[_-]?account[_-]?number/i,
  /raw[_-]?body/i,
];

function collectKeys(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const el of node) collectKeys(el, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
}

describe('contract inventory has no secret/PII-bearing fields', () => {
  it('registers a meaningful set of named components', () => {
    expect(COMPONENTS.length).toBeGreaterThan(20);
  });

  it('no forbidden property names appear in the OpenAPI component schemas', () => {
    const doc = buildOpenApiDocument();
    const keys = new Set<string>();
    collectKeys(doc.components?.schemas ?? {}, keys);

    const offenders = [...keys].filter(
      (k) => k !== 'raw_payload_ref' && FORBIDDEN.some((re) => re.test(k)),
    );
    expect(offenders, `forbidden field names: ${offenders.join(', ')}`).toEqual([]);
  });

  it('permits the opaque raw_payload_ref but not a raw payload/body field', () => {
    const doc = buildOpenApiDocument();
    const keys = new Set<string>();
    collectKeys(doc.components?.schemas ?? {}, keys);
    expect(keys.has('raw_payload_ref')).toBe(true);
    expect(keys.has('raw_payload')).toBe(false);
    expect(keys.has('rawBody')).toBe(false);
  });
});
