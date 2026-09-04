import { z } from 'zod';

/**
 * Validated, server-only environment configuration.
 *
 * This module is server-only and MUST NOT be imported by browser (web) code.
 * It never logs secret values; callers receive parsed values and are expected
 * to keep secrets out of logs (see src/config/logger.ts redaction).
 */

/** Runtime environments MoneyTrace recognises. */
export const MoneyTraceEnvironment = z.enum([
  'demo',
  'buildathon',
  'test',
  'development',
  'production',
]);
export type MoneyTraceEnvironment = z.infer<typeof MoneyTraceEnvironment>;

/**
 * Environments that are demonstration/prototype contexts. In these, any
 * Razorpay LIVE key is a hard safety error: the Buildathon prototype must never
 * be able to move real money (architecture handoff §21.8, final rule #1).
 */
const DEMO_LIKE_ENVIRONMENTS: ReadonlySet<MoneyTraceEnvironment> = new Set(['demo', 'buildathon']);

export function isDemoLikeEnvironment(environment: MoneyTraceEnvironment): boolean {
  return DEMO_LIKE_ENVIRONMENTS.has(environment);
}

export class RealAuthenticationRequiredError extends Error {
  constructor() {
    super('non-demo MoneyTrace environments require a real authentication provider');
    this.name = 'RealAuthenticationRequiredError';
  }
}

/**
 * Demo-header identity must never become an accidental production auth
 * mechanism. Test mode is allowed only under the test process environment.
 */
export function assertAuthenticationEnvironment(env: {
  readonly MONEYTRACE_ENV: MoneyTraceEnvironment;
  readonly NODE_ENV: 'development' | 'test' | 'production';
}): void {
  if (isDemoLikeEnvironment(env.MONEYTRACE_ENV)) return;
  if (env.MONEYTRACE_ENV === 'test' && env.NODE_ENV === 'test') return;
  throw new RealAuthenticationRequiredError();
}

/** Prefix that identifies a Razorpay LIVE (real-money) key. */
export const RAZORPAY_LIVE_KEY_PREFIX = 'rzp_live_';

/**
 * Pure safety guard: reject Razorpay LIVE keys in demo-like environments.
 *
 * Throws {@link LiveKeyInDemoError} when a `rzp_live_` key id or secret is
 * present while running in a demo/buildathon environment. The error message
 * NEVER contains the secret value.
 */
export class LiveKeyInDemoError extends Error {
  constructor(field: string) {
    super(
      `Refusing to start: ${field} is a Razorpay live key (rzp_live_) but ` +
        `MONEYTRACE_ENV is a demo/buildathon environment. Live, real-money ` +
        `credentials are forbidden in the prototype. Use test-mode keys.`,
    );
    this.name = 'LiveKeyInDemoError';
  }
}

function isLiveKey(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith(RAZORPAY_LIVE_KEY_PREFIX);
}

const OptionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

/**
 * Assert no Razorpay live key is configured in a demo-like environment.
 * Exported and independently testable; used inside {@link loadEnv}.
 */
export function assertNoLiveKeyInDemo(input: {
  environment: MoneyTraceEnvironment;
  razorpayKeyId?: string | undefined;
  razorpayKeySecret?: string | undefined;
}): void {
  if (!isDemoLikeEnvironment(input.environment)) {
    return;
  }
  if (isLiveKey(input.razorpayKeyId)) {
    throw new LiveKeyInDemoError('RAZORPAY_KEY_ID');
  }
  if (isLiveKey(input.razorpayKeySecret)) {
    throw new LiveKeyInDemoError('RAZORPAY_KEY_SECRET');
  }
}

/** Zod schema for the raw process environment. */
export const EnvSchema = z
  .object({
    MONEYTRACE_ENV: MoneyTraceEnvironment.default('demo'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    API_PORT: z.coerce.number().int().positive().max(65535).default(3000),
    API_HOST: z.string().min(1).default('127.0.0.1'),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.string().url().optional(),

    RAZORPAY_KEY_ID: OptionalNonEmptyString,
    RAZORPAY_KEY_SECRET: OptionalNonEmptyString,
    RAZORPAY_WEBHOOK_SECRET: OptionalNonEmptyString,

    SYNTHETIC_SOURCE_HMAC_SECRET: OptionalNonEmptyString,

    MODEL_PROVIDER: z.string().min(1).default('stub'),
    MODEL_API_URL: z.string().url().optional(),
    MODEL_API_KEY: OptionalNonEmptyString,
  })
  .superRefine((env, ctx) => {
    try {
      assertNoLiveKeyInDemo({
        environment: env.MONEYTRACE_ENV,
        razorpayKeyId: env.RAZORPAY_KEY_ID,
        razorpayKeySecret: env.RAZORPAY_KEY_SECRET,
      });
    } catch (error) {
      if (error instanceof LiveKeyInDemoError) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: error.message });
        return;
      }
      throw error;
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/**
 * A well-known, clearly-fake placeholder (never a real secret) used to sign
 * SYNTHETIC evidence in demo/test when no operator-supplied
 * `SYNTHETIC_SOURCE_HMAC_SECRET` exists. It authenticates the internal
 * synthetic-connector boundary against accidental cross-source injection, not
 * against a real attacker — this is a prototype convenience, never a
 * production credential, and is refused outside demo/buildathon/test.
 */
export const TEST_ONLY_SYNTHETIC_HMAC_SECRET = 'TEST_ONLY_synthetic_hmac_secret_do_not_use_in_prod';

export class SyntheticHmacSecretRequiredError extends Error {
  constructor() {
    super('SYNTHETIC_SOURCE_HMAC_SECRET is required outside demo/buildathon/test environments');
    this.name = 'SyntheticHmacSecretRequiredError';
  }
}

/**
 * Resolve the secret used to sign/verify synthetic connector evidence. Demo,
 * buildathon, and test environments fall back to the fixed test-only
 * placeholder when unset; every other environment requires an explicit value.
 */
export function resolveSyntheticHmacSecret(
  env: Pick<Env, 'MONEYTRACE_ENV' | 'SYNTHETIC_SOURCE_HMAC_SECRET'>,
): string {
  if (env.SYNTHETIC_SOURCE_HMAC_SECRET) return env.SYNTHETIC_SOURCE_HMAC_SECRET;
  if (isDemoLikeEnvironment(env.MONEYTRACE_ENV) || env.MONEYTRACE_ENV === 'test') {
    return TEST_ONLY_SYNTHETIC_HMAC_SECRET;
  }
  throw new SyntheticHmacSecretRequiredError();
}

/**
 * Parse and validate an environment object (defaults to `process.env`).
 * Throws a redacted error (no secret values) when validation fails.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    // Report only field names and messages; never echo raw values (which may be secrets).
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid MoneyTrace environment configuration: ${problems}`);
  }
  return result.data;
}
