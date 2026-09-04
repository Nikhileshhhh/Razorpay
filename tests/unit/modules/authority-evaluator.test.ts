import { describe, expect, it } from 'vitest';
import { evaluateContractAuthority } from '../../../src/modules/verification/authority-evaluator.js';
import { VERIFICATION_CONTRACT_DEFINITIONS } from '../../../src/modules/verification/verification-contracts-seed.js';

const transferContract = VERIFICATION_CONTRACT_DEFINITIONS.find(
  (c) => c.contract_key === 'TRANSFER_REMEDIATION_VERIFICATION',
)!;

const completeBankFacts = [
  {
    field: 'amount' as const,
    sourceSystem: 'SYNTHETIC_BANK' as const,
    authorityClass: 'AUTHORITATIVE' as const,
  },
  {
    field: 'currency' as const,
    sourceSystem: 'SYNTHETIC_BANK' as const,
    authorityClass: 'AUTHORITATIVE' as const,
  },
  {
    field: 'recipient' as const,
    sourceSystem: 'SYNTHETIC_BANK' as const,
    authorityClass: 'AUTHORITATIVE' as const,
  },
  {
    field: 'value_date' as const,
    sourceSystem: 'SYNTHETIC_BANK' as const,
    authorityClass: 'AUTHORITATIVE' as const,
  },
];

const allRequiredEvidence = new Set(transferContract.required_evidence);

describe('pure authority evaluator (ADR 0002 D7)', () => {
  it('verifies only when every required evidence type and authority bucket is satisfied', () => {
    const result = evaluateContractAuthority({
      contract: transferContract,
      presentEvidenceTypes: allRequiredEvidence,
      presentBlockers: new Set(),
      facts: completeBankFacts,
    });
    expect(result.status).toBe('EFFECT_VERIFIED');
  });

  it('stays pending when the bank_credit evidence type is missing', () => {
    const withoutBank = new Set([...allRequiredEvidence].filter((t) => t !== 'bank_credit'));
    const result = evaluateContractAuthority({
      contract: transferContract,
      presentEvidenceTypes: withoutBank,
      presentBlockers: new Set(),
      facts: completeBankFacts,
    });
    expect(result.status).toBe('VERIFICATION_PENDING');
    if (result.status === 'VERIFICATION_PENDING') {
      expect(result.blockers).toContain('MISSING_REQUIRED_EVIDENCE:bank_credit');
    }
  });

  it('settlement is never bank proof: a non-bank fact never satisfies the amount/identity/time buckets', () => {
    const settlementOnlyFacts = [
      {
        field: 'amount' as const,
        sourceSystem: 'SYNTHETIC_ROUTE' as const,
        authorityClass: 'AUTHORITATIVE' as const,
      },
      {
        field: 'recipient' as const,
        sourceSystem: 'SYNTHETIC_ROUTE' as const,
        authorityClass: 'AUTHORITATIVE' as const,
      },
    ];
    const result = evaluateContractAuthority({
      contract: transferContract,
      presentEvidenceTypes: allRequiredEvidence,
      presentBlockers: new Set(),
      facts: settlementOnlyFacts,
    });
    expect(result.status).toBe('VERIFICATION_PENDING');
    if (result.status === 'VERIFICATION_PENDING') {
      expect(result.blockers).toContain('INSUFFICIENT_AUTHORITY:amount');
      expect(result.blockers).toContain('INSUFFICIENT_AUTHORITY:identity');
    }
  });

  it('the agent can never satisfy a bucket because it is never a registered authority', () => {
    const agentFacts = [
      {
        field: 'amount' as const,
        sourceSystem: 'SYNTHETIC_AGENT' as const,
        authorityClass: 'AUTHORITATIVE' as const,
      },
    ];
    const result = evaluateContractAuthority({
      contract: transferContract,
      presentEvidenceTypes: allRequiredEvidence,
      presentBlockers: new Set(),
      facts: agentFacts,
    });
    expect(result.status).toBe('VERIFICATION_PENDING');
    if (result.status === 'VERIFICATION_PENDING') {
      expect(result.blockers).toContain('INSUFFICIENT_AUTHORITY:amount');
    }
  });

  it('a blocking evidence type (e.g. a pending refund) prevents verification', () => {
    const result = evaluateContractAuthority({
      contract: transferContract,
      presentEvidenceTypes: allRequiredEvidence,
      presentBlockers: new Set(['refund_pending']),
      facts: completeBankFacts,
    });
    expect(result.status).toBe('VERIFICATION_PENDING');
    if (result.status === 'VERIFICATION_PENDING') {
      expect(result.blockers).toContain('BLOCKED_BY:refund_pending');
    }
  });
});
