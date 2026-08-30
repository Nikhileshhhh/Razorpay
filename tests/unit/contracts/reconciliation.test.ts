import { describe, expect, it } from 'vitest';
import { ReconciliationResult } from '../../../src/contracts/reconciliation.js';

const allocation = {
  allocation_id: 'alloc_1',
  bank_line_evidence_id: 'ev_bank_1',
  expectation_id: 'exp_1',
  amount: { amount_minor: '45500000', currency: 'INR' },
};

const base = (over: Record<string, unknown>) => ({
  schema_version: '1.0',
  reconciliation_id: 'rec_1',
  case_id: 'case_1',
  subject_id: 'subj_1',
  matched_amount: { amount_minor: '45500000', currency: 'INR' },
  difference: { amount_minor: '0', currency: 'INR' },
  match_type: 'EXACT_ONE_TO_ONE',
  evidence_ids: ['ev_bank_1'],
  status: 'ALLOCATED',
  closed_receivable_id: 'recv_1',
  allocation,
  created_at: '2026-08-25T09:00:00Z',
  ...over,
});

describe('reconciliation result', () => {
  it('accepts an allocated result with its allocation', () => {
    expect(ReconciliationResult.parse(base({})).status).toBe('ALLOCATED');
  });

  it('rejects an ALLOCATED result without an allocation', () => {
    expect(ReconciliationResult.safeParse(base({ allocation: null })).success).toBe(false);
  });

  it('rejects disagreeing currencies (a non-INR currency is refused outright)', () => {
    expect(
      ReconciliationResult.safeParse(
        base({ matched_amount: { amount_minor: '1', currency: 'USD' } }),
      ).success,
    ).toBe(false);
  });
});
