import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CanonicalEvent,
  type CanonicalEvent as CanonicalEventContract,
} from '../../../src/contracts/events/canonical-event.js';
import {
  CanonicalEventType,
  type CanonicalEventType as CanonicalEventTypeContract,
  type SourceSystem,
} from '../../../src/contracts/events/event-types.js';
import { BankCreditObservedData } from '../../../src/contracts/events/payloads.js';
import { SubmitEventRequest } from '../../../src/contracts/api-endpoints.js';

const load = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../fixtures/contracts/${name}`, import.meta.url)),
      'utf8',
    ),
  );

const clone = (base: Record<string, unknown>, overrides: Record<string, unknown>) => ({
  ...structuredClone(base),
  ...overrides,
});

const payment = () => load('payment-captured.valid.json');
const bank = () => load('bank-credit-observed.valid.json');

describe('canonical event envelope', () => {
  it('parses valid PaymentCaptured and BankCreditObserved fixtures', () => {
    expect(CanonicalEvent.parse(payment()).event_type).toBe('PaymentCaptured');
    const bc = CanonicalEvent.parse(bank());
    if (bc.event_type !== 'BankCreditObserved') throw new Error('wrong variant');
    expect(BankCreditObservedData.parse(bc.data).utr).toBe('UTRTEST0001');
  });

  it('exports a strongly typed contract instead of any', () => {
    expectTypeOf<CanonicalEventContract>().not.toBeAny();
    expectTypeOf<
      CanonicalEventContract['event_type']
    >().toEqualTypeOf<CanonicalEventTypeContract>();
    expectTypeOf<CanonicalEventContract['source_system']>().toEqualTypeOf<SourceSystem>();
    expectTypeOf<CanonicalEventContract['metadata']['environment']>().toEqualTypeOf<
      'test' | 'synthetic'
    >();
    expectTypeOf<CanonicalEventContract['amount_minor']>().not.toBeAny();
    expectTypeOf<CanonicalEventContract['currency']>().not.toBeAny();
    expectTypeOf<CanonicalEventContract['data']>().not.toBeAny();
  });

  it('keeps source_event_type as a preserved bounded string, distinct from event_type', () => {
    const parsed = CanonicalEvent.parse(payment());
    expect(parsed.source_event_type).toBe('payment.captured');
    expect(CanonicalEventType.safeParse(parsed.source_event_type).success).toBe(false);
  });

  it('rejects unknown event_type, JSON-number money, and unknown envelope props', () => {
    expect(CanonicalEvent.safeParse(load('event.invalid-unknown-type.json')).success).toBe(false);
    expect(CanonicalEvent.safeParse(load('event.invalid-money-number.json')).success).toBe(false);
    expect(CanonicalEvent.safeParse(clone(payment(), { sneaky: true })).success).toBe(false);
  });

  it('allows optional source fields to be null/absent (never inferred)', () => {
    const parsed = CanonicalEvent.parse(bank());
    expect(parsed.source_account_id).toBeNull();
    expect(parsed.source_event_id).toBeNull();
  });
});

describe('SubmitEventRequest is the authoritative validator (finding 1)', () => {
  it('rejects amount_minor without currency', () => {
    const { currency: _c, ...noCurrency } = payment();
    expect(SubmitEventRequest.safeParse(noCurrency).success).toBe(false);
  });

  it('rejects currency without amount_minor', () => {
    const { amount_minor: _a, ...noAmount } = payment();
    expect(SubmitEventRequest.safeParse(noAmount).success).toBe(false);
  });

  it('accepts both amount and currency absent together', () => {
    const { amount_minor: _a, currency: _c, ...neither } = payment();
    expect(SubmitEventRequest.safeParse(neither).success).toBe(true);
  });
});

describe('source-system provenance enforcement (finding 2)', () => {
  it('rejects a Razorpay-labelled BankCreditObserved', () => {
    expect(
      CanonicalEvent.safeParse(
        clone(bank(), { source_system: 'RAZORPAY_TEST', metadata: { environment: 'test' } }),
      ).success,
    ).toBe(false);
  });

  it('rejects a Razorpay-labelled SyntheticTransferFailed', () => {
    const ev = clone(payment(), {
      event_type: 'SyntheticTransferFailed',
      source_system: 'RAZORPAY_TEST',
      metadata: { environment: 'test' },
    });
    expect(CanonicalEvent.safeParse(ev).success).toBe(false);
  });

  it('rejects a synthetic-bank-labelled PaymentCaptured', () => {
    expect(
      CanonicalEvent.safeParse(
        clone(payment(), {
          source_system: 'SYNTHETIC_BANK',
          metadata: { environment: 'synthetic' },
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects RAZORPAY_TEST with a live/non-test environment', () => {
    expect(
      CanonicalEvent.safeParse(clone(payment(), { metadata: { environment: 'live' } })).success,
    ).toBe(false);
    expect(
      CanonicalEvent.safeParse(clone(payment(), { metadata: { environment: 'synthetic' } }))
        .success,
    ).toBe(false);
  });

  it('rejects a synthetic source with environment=test', () => {
    const ev = clone(payment(), {
      source_system: 'SYNTHETIC_ROUTE',
      event_type: 'TransferProcessed',
      metadata: { environment: 'test' },
    });
    expect(CanonicalEvent.safeParse(ev).success).toBe(false);
  });

  it('accepts a valid signed synthetic Razorpay-shaped fixture source', () => {
    const ev = clone(payment(), {
      source_system: 'SYNTHETIC_RAZORPAY_FIXTURE',
      metadata: { environment: 'synthetic' },
    });
    expect(CanonicalEvent.safeParse(ev).success).toBe(true);
  });
});
