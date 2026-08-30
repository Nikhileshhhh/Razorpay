import { describe, expect, it } from 'vitest';
import { OpaqueId, Sha256Hash, SubjectKey } from '../../../src/contracts/common/identifiers.js';
import { Rfc3339Utc } from '../../../src/contracts/common/timestamps.js';

describe('timestamps', () => {
  it('accepts RFC3339 UTC instants', () => {
    for (const v of ['2026-08-25T05:20:00Z', '2026-08-25T05:20:00.123Z']) {
      expect(Rfc3339Utc.parse(v)).toBe(v);
    }
  });

  it('rejects non-UTC offsets, missing Z, and impossible dates', () => {
    for (const v of [
      '2026-08-25T05:20:00+05:30',
      '2026-08-25 05:20:00',
      '2026-08-25T05:20:00',
      '2026-13-40T00:00:00Z',
    ]) {
      expect(Rfc3339Utc.safeParse(v).success, `expected reject: ${v}`).toBe(false);
    }
  });
});

describe('identifiers', () => {
  it('accepts bounded opaque ids incl. subject keys with colons', () => {
    expect(OpaqueId.parse('pay_901')).toBe('pay_901');
    expect(SubjectKey.parse('order:merchant-order-718:seller-42')).toBe(
      'order:merchant-order-718:seller-42',
    );
  });

  it('rejects empty and over-long ids', () => {
    expect(OpaqueId.safeParse('').success).toBe(false);
    expect(OpaqueId.safeParse('a'.repeat(129)).success).toBe(false);
  });

  it('sha256 hash requires the sha256:<64 lowercase hex> shape', () => {
    expect(Sha256Hash.parse(`sha256:${'a'.repeat(64)}`)).toContain('sha256:');
    for (const v of [
      `sha256:${'A'.repeat(64)}`,
      `sha256:${'a'.repeat(63)}`,
      'a'.repeat(64),
      `md5:${'a'.repeat(64)}`,
    ]) {
      expect(Sha256Hash.safeParse(v).success, `expected reject: ${v}`).toBe(false);
    }
  });
});
