import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { isUniqueViolation, toSafeError } from '../../src/config/errors.js';
import { REDACT_PATHS } from '../../src/config/logger.js';

// Unmistakable non-credential MARKERS embedded inside an arbitrary error
// message. They are obviously fake (so secret scanners do not flag them) yet
// still prove that raw error text / secret-bearing fields are never emitted.
const FAKE_PG_URL =
  'postgres://TEST_ONLY_USER:TEST_ONLY_PASSWORD_MARKER@db.invalid:5432/moneytrace_test';
const FAKE_PASSWORD = 'TEST_ONLY_PASSWORD_MARKER';
const FAKE_BEARER = 'Bearer TEST_ONLY_TOKEN_MARKER';
const FAKE_RAZORPAY_SECRET = 'rzp_test_FAKE_TEST_ONLY';

function makeLeakyError(): Error & { code?: string } {
  const err = new Error(
    `connection failed to ${FAKE_PG_URL} with password ${FAKE_PASSWORD}, ` +
      `authorization ${FAKE_BEARER}, key ${FAKE_RAZORPAY_SECRET}`,
  ) as Error & { code?: string };
  err.code = 'ECONNREFUSED';
  return err;
}

const ALL_SECRETS = [FAKE_PG_URL, FAKE_PASSWORD, FAKE_BEARER, FAKE_RAZORPAY_SECRET];

describe('toSafeError', () => {
  it('never includes the raw error message or any embedded secret', () => {
    const safe = toSafeError(makeLeakyError(), 'database');
    const serialized = JSON.stringify(safe);
    for (const secret of ALL_SECRETS) {
      expect(serialized).not.toContain(secret);
    }
    expect(safe.category).toBe('database');
    expect(safe.name).toBe('Error');
    expect(safe.code).toBe('ECONNREFUSED');
  });

  it('drops a non-allowlisted error name and any long non-code value', () => {
    const weird = new Error('boom') as Error & { code?: string };
    weird.name = 'SecretLeakingCustomError_' + FAKE_PASSWORD;
    weird.code = FAKE_RAZORPAY_SECRET; // not a valid short code -> dropped
    const safe = toSafeError(weird);
    expect(safe.name).toBe('Error');
    expect(safe.code).toBeUndefined();
    expect(JSON.stringify(safe)).not.toContain(FAKE_PASSWORD);
    expect(JSON.stringify(safe)).not.toContain(FAKE_RAZORPAY_SECRET);
  });
});

describe('isUniqueViolation', () => {
  it('matches a raw pg-style error with code/constraint set directly', () => {
    const raw = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'entity_link_reviews_uq',
    });
    expect(isUniqueViolation(raw, 'entity_link_reviews_uq')).toBe(true);
    expect(isUniqueViolation(raw, 'some_other_constraint')).toBe(false);
  });

  it("matches when the real pg error is wrapped one level deep via `.cause` (drizzle-orm's DrizzleQueryError shape)", () => {
    const wrapped = new Error('Failed query') as Error & { cause?: unknown };
    wrapped.cause = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'entity_link_reviews_uq',
    });
    expect(isUniqueViolation(wrapped, 'entity_link_reviews_uq')).toBe(true);
  });

  it('does not match an unrelated error, a different SQLSTATE, or a different constraint name', () => {
    expect(isUniqueViolation(new Error('boom'), 'entity_link_reviews_uq')).toBe(false);
    expect(
      isUniqueViolation(
        Object.assign(new Error('fk violation'), {
          code: '23503',
          constraint: 'entity_link_reviews_uq',
        }),
        'entity_link_reviews_uq',
      ),
    ).toBe(false);
    expect(
      isUniqueViolation(
        Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'other_uq' }),
        'entity_link_reviews_uq',
      ),
    ).toBe(false);
    expect(isUniqueViolation(null, 'entity_link_reviews_uq')).toBe(false);
    expect(isUniqueViolation(undefined, 'entity_link_reviews_uq')).toBe(false);
  });
});

describe('logging a safe error through the redacting logger', () => {
  function loggerWritingTo(lines: string[]) {
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    return pino({ level: 'info', redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, sink);
  }

  it('emits no secret text when logging toSafeError output', () => {
    const lines: string[] = [];
    const log = loggerWritingTo(lines);
    log.fatal({ msg: 'API failed to start', err: toSafeError(makeLeakyError(), 'startup') });
    const output = lines.join('');
    for (const secret of ALL_SECRETS) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('startup');
  });

  it('redacts DATABASE_URL and nested authorization headers if ever passed as fields', () => {
    const lines: string[] = [];
    const log = loggerWritingTo(lines);
    log.info({
      DATABASE_URL: FAKE_PG_URL,
      req: { headers: { authorization: FAKE_BEARER } },
      rawBody: FAKE_RAZORPAY_SECRET,
    });
    const output = lines.join('');
    expect(output).toContain('[REDACTED]');
    for (const secret of ALL_SECRETS) {
      expect(output).not.toContain(secret);
    }
  });
});
