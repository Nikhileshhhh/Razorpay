import { describe, expect, it } from 'vitest';
import * as contracts from '../../../src/contracts/index.js';

/**
 * The public browser-safe barrel must not export any weaker OpenAPI-only
 * composition schema. There is a single authoritative schema per contract, so no
 * export name may contain `OpenApiSchema` (nor any `*Shape` weaker twin).
 */
describe('public contract barrel', () => {
  it('exports no weaker OpenAPI-only / shape schemas', () => {
    const offenders = Object.keys(contracts).filter((k) => /OpenApiSchema|EventShape$/.test(k));
    expect(offenders, `unexpected weaker exports: ${offenders.join(', ')}`).toEqual([]);
  });

  it('exports the authoritative schemas', () => {
    for (const name of [
      'CanonicalEvent',
      'ModelInvestigationOutput',
      'Plan',
      'ReconciliationResult',
      'VerificationContract',
    ]) {
      expect(name in contracts, `missing export ${name}`).toBe(true);
    }
  });
});
