import { describe, expect, it } from 'vitest';
import {
  assertNoLiveKeyInDemo,
  isDemoLikeEnvironment,
  LiveKeyInDemoError,
  loadEnv,
  RAZORPAY_LIVE_KEY_PREFIX,
} from '../../src/config/env.js';

const BASE_ENV = {
  MONEYTRACE_ENV: 'demo',
  NODE_ENV: 'test',
  API_PORT: '3000',
  API_HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
  MODEL_PROVIDER: 'stub',
} satisfies NodeJS.ProcessEnv;

describe('environment validation', () => {
  it('parses a valid demo environment with defaults', () => {
    const env = loadEnv(BASE_ENV);
    expect(env.MONEYTRACE_ENV).toBe('demo');
    expect(env.API_PORT).toBe(3000);
    expect(env.MODEL_PROVIDER).toBe('stub');
  });

  it('rejects an out-of-range port without echoing the value', () => {
    expect(() => loadEnv({ ...BASE_ENV, API_PORT: '70000' })).toThrowError(
      /Invalid MoneyTrace environment configuration/,
    );
  });

  it('rejects an unknown MONEYTRACE_ENV', () => {
    expect(() => loadEnv({ ...BASE_ENV, MONEYTRACE_ENV: 'staging' })).toThrowError(
      /Invalid MoneyTrace environment configuration/,
    );
  });

  it('accepts test-mode Razorpay keys in demo', () => {
    const env = loadEnv({
      ...BASE_ENV,
      RAZORPAY_KEY_ID: 'rzp_test_FAKE_TEST_ONLY',
      RAZORPAY_KEY_SECRET: 'TEST_ONLY_SECRET_MARKER',
    });
    expect(env.RAZORPAY_KEY_ID).toBe('rzp_test_FAKE_TEST_ONLY');
  });
});

describe('isDemoLikeEnvironment', () => {
  it.each(['demo', 'buildathon'] as const)('treats %s as demo-like', (environment) => {
    expect(isDemoLikeEnvironment(environment)).toBe(true);
  });

  it.each(['test', 'development', 'production'] as const)(
    'does not treat %s as demo-like',
    (environment) => {
      expect(isDemoLikeEnvironment(environment)).toBe(false);
    },
  );
});

describe('live-key safety guard', () => {
  it('exposes the expected live-key prefix', () => {
    expect(RAZORPAY_LIVE_KEY_PREFIX).toBe('rzp_live_');
  });

  it('rejects a live key id in a demo environment', () => {
    expect(() =>
      assertNoLiveKeyInDemo({
        environment: 'demo',
        razorpayKeyId: 'rzp_live_FAKE_TEST_ONLY',
      }),
    ).toThrow(LiveKeyInDemoError);
  });

  it('rejects a live key secret in a buildathon environment', () => {
    expect(() =>
      assertNoLiveKeyInDemo({
        environment: 'buildathon',
        razorpayKeySecret: 'rzp_live_FAKE_TEST_ONLY',
      }),
    ).toThrow(LiveKeyInDemoError);
  });

  it('never includes the secret value in the error message', () => {
    const liveKey = 'rzp_live_TEST_ONLY_DO_NOT_LEAK_MARKER';
    try {
      assertNoLiveKeyInDemo({ environment: 'demo', razorpayKeyId: liveKey });
      throw new Error('expected guard to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(LiveKeyInDemoError);
      expect((error as Error).message).not.toContain(liveKey);
      expect((error as Error).message).not.toContain('TEST_ONLY_DO_NOT_LEAK');
    }
  });

  it('allows a live key outside demo-like environments (e.g. production)', () => {
    expect(() =>
      assertNoLiveKeyInDemo({
        environment: 'production',
        razorpayKeyId: 'rzp_live_FAKE_TEST_ONLY',
      }),
    ).not.toThrow();
  });

  it('loadEnv fails when a live key is set in demo', () => {
    expect(() =>
      loadEnv({ ...BASE_ENV, MONEYTRACE_ENV: 'demo', RAZORPAY_KEY_ID: 'rzp_live_FAKE_TEST_ONLY' }),
    ).toThrowError(/live key/i);
  });
});
