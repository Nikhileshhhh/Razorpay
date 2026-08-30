import { describe, expect, it } from 'vitest';
import {
  CANONICAL_EVENT_CLASSIFICATIONS,
  type CanonicalEventClassification,
} from '../../../src/contracts/events/classification.js';

const byType = new Map<string, CanonicalEventClassification>(
  CANONICAL_EVENT_CLASSIFICATIONS.map((c) => [c.event_type, c]),
);
const get = (t: string): CanonicalEventClassification => {
  const c = byType.get(t);
  if (!c) throw new Error(`missing classification: ${t}`);
  return c;
};

describe('canonical event source classification (§8.2)', () => {
  it('OrderCreated is not a Razorpay webhook', () => {
    expect(get('OrderCreated').may_originate_from).not.toContain('RAZORPAY_WEBHOOK_OR_FETCH');
  });

  it('SettlementCreated and SettlementObserved are canonical observations, not webhooks', () => {
    for (const t of ['SettlementCreated', 'SettlementObserved']) {
      expect(get(t).may_originate_from).toEqual(['CANONICAL_OBSERVATION']);
    }
  });

  it('SettlementProcessed is not bank-credit evidence and cannot masquerade as BankCreditObserved', () => {
    expect(get('SettlementProcessed').is_bank_credit_evidence).toBe(false);
    expect(get('BankCreditObserved').is_bank_credit_evidence).toBe(true);
  });

  it('BankCreditObserved is synthetic-required', () => {
    expect(get('BankCreditObserved').may_originate_from).toEqual(['SYNTHETIC_REQUIRED']);
  });

  it('SyntheticTransferFailed is synthetic-only and never a Razorpay fact', () => {
    const c = get('SyntheticTransferFailed');
    expect(c.may_originate_from).toEqual(['SYNTHETIC_REQUIRED']);
    expect(c.may_originate_from.some((o) => o.startsWith('RAZORPAY'))).toBe(false);
  });

  it('the Razorpay-webhook-capable set equals exactly the documented webhook events', () => {
    const webhookCapable = CANONICAL_EVENT_CLASSIFICATIONS.filter((c) =>
      c.may_originate_from.includes('RAZORPAY_WEBHOOK_OR_FETCH'),
    )
      .map((c) => c.event_type)
      .sort();
    expect(webhookCapable).toEqual(
      [
        'OrderPaid',
        'PaymentAuthorized',
        'PaymentCaptured',
        'PaymentFailed',
        'RefundCreated',
        'RefundProcessed',
        'RefundFailed',
        'TransferProcessed',
        'SettlementProcessed',
      ].sort(),
    );
  });
});
