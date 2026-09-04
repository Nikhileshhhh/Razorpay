import { describe, expect, it } from 'vitest';
import { PrototypeRateLimiter } from '../../src/api/prototype-rate-limiter.js';

describe('prototype rate limiter', () => {
  it('admits the configured burst, rejects excess, and resets by window', () => {
    const limiter = new PrototypeRateLimiter(2, 1_000);
    expect(limiter.allow('tenant:user', 10_000)).toBe(true);
    expect(limiter.allow('tenant:user', 10_001)).toBe(true);
    expect(limiter.allow('tenant:user', 10_002)).toBe(false);
    expect(limiter.allow('tenant:user', 11_000)).toBe(true);
  });

  it('isolates callers so one source cannot consume another source retry budget', () => {
    const limiter = new PrototypeRateLimiter(1, 1_000);
    expect(limiter.allow('source:a', 1)).toBe(true);
    expect(limiter.allow('source:a', 2)).toBe(false);
    expect(limiter.allow('source:b', 2)).toBe(true);
  });
});
