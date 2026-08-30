import { describe, expect, it } from 'vitest';
import { DateOnly } from '../../../src/contracts/common/identifiers.js';
import { Rfc3339Utc } from '../../../src/contracts/common/timestamps.js';

describe('calendar-aware RFC3339 UTC timestamps', () => {
  it('accepts real dates including leap day and fractional seconds', () => {
    for (const v of [
      '2024-02-29T00:00:00Z',
      '2026-08-25T05:20:00Z',
      '2026-08-25T05:20:00.123Z',
      '2026-12-31T23:59:59Z',
    ]) {
      expect(Rfc3339Utc.parse(v)).toBe(v);
    }
  });

  it('rejects impossible calendar dates (never normalized)', () => {
    for (const v of [
      '2026-02-29T00:00:00Z', // 2026 is not a leap year
      '2026-02-30T00:00:00Z',
      '2026-04-31T00:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-00-10T00:00:00Z',
    ]) {
      expect(Rfc3339Utc.safeParse(v).success, `expected reject: ${v}`).toBe(false);
    }
  });

  it('rejects impossible times', () => {
    for (const v of ['2026-08-25T25:00:00Z', '2026-08-25T05:60:00Z', '2026-08-25T05:20:60Z']) {
      expect(Rfc3339Utc.safeParse(v).success, `expected reject: ${v}`).toBe(false);
    }
  });
});

describe('calendar-aware DateOnly', () => {
  it('accepts real dates including leap day', () => {
    expect(DateOnly.parse('2024-02-29')).toBe('2024-02-29');
    expect(DateOnly.parse('2026-08-25')).toBe('2026-08-25');
  });

  it('rejects impossible calendar dates', () => {
    for (const v of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-99-99', '2026-13-01']) {
      expect(DateOnly.safeParse(v).success, `expected reject: ${v}`).toBe(false);
    }
  });
});
