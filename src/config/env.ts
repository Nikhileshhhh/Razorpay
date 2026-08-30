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

    RAZORPAY_KEY_ID: z.string().min(1).optional(),
    RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),

    SYNTHETIC_SOURCE_HMAC_SECRET: z.string().min(1).optional(),

    MODEL_PROVIDER: z.string().min(1).default('stub'),
    MODEL_API_URL: z.string().url().optional(),
    MODEL_API_KEY: z.string().min(1).optional(),
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
