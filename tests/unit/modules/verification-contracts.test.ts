import { describe, expect, it } from 'vitest';
import { VerificationContract } from '../../../src/contracts/verification.js';
import { VERIFICATION_CONTRACT_DEFINITIONS } from '../../../src/modules/verification/verification-contracts-seed.js';
import { VERIFICATION_CONTRACT_BY_TOOL } from '../../../src/modules/approvals/decision-basis.js';

describe('seeded verification contracts (ADR 0002 D7)', () => {
  it('seeds exactly the four keys the decision basis binds', () => {
    const seeded = VERIFICATION_CONTRACT_DEFINITIONS.map(
      (c) => `${c.contract_key}/${c.version}`,
    ).sort();
    const bound = Object.values(VERIFICATION_CONTRACT_BY_TOOL)
      .map((c) => `${c.key}/${c.version}`)
      .sort();
    expect(seeded).toEqual([...new Set(bound)].sort());
  });

  it('every definition is a valid VerificationContract with all four required checks', () => {
    for (const def of VERIFICATION_CONTRACT_DEFINITIONS) {
      expect(VerificationContract.safeParse(def).success, def.contract_key).toBe(true);
      expect(def.required_checks).toEqual({
        amount: true,
        currency: true,
        identity: true,
        time: true,
      });
      expect(def.terminal_state).toBe('EFFECT_VERIFIED');
    }
  });

  it('the transfer contract is satisfied only by a SYNTHETIC_BANK amount/identity/time authority', () => {
    const transfer = VERIFICATION_CONTRACT_DEFINITIONS.find(
      (c) => c.contract_key === 'TRANSFER_REMEDIATION_VERIFICATION',
    )!;
    for (const bucket of ['amount', 'currency', 'identity', 'time'] as const) {
      for (const authority of transfer.required_authorities[bucket]) {
        expect(authority.source_system).toBe('SYNTHETIC_BANK');
        expect(authority.authority_class).toBe('AUTHORITATIVE');
      }
    }
    // bank credit is a required evidence type; settlement processed alone is not sufficient.
    expect(transfer.required_evidence).toContain('bank_credit');
    expect(transfer.required_evidence).toContain('seller_receivable_closed');
    expect(transfer.required_evidence).not.toEqual(
      expect.arrayContaining(['seller_receivable_opened']),
    );
  });

  it('distinguishes an opened receivable from authoritative closure evidence', () => {
    const closure = VERIFICATION_CONTRACT_DEFINITIONS.find(
      (c) => c.contract_key === 'RECEIVABLE_CLOSURE_VERIFICATION',
    )!;
    expect(closure.required_evidence).toEqual(['seller_receivable_closed']);
    expect(closure.required_evidence).not.toContain('seller_receivable');
  });
});
