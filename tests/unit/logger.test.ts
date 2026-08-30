import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createLogger, REDACT_PATHS } from '../../src/config/logger.js';

/**
 * Verifies the logger never emits secret values: secret-bearing fields are
 * redacted (architecture handoff §21.5, final rule #16). We build a pino logger
 * with the SAME redaction paths the app uses, writing to an in-memory sink, and
 * assert the raw secrets never appear in the output.
 */
function loggerWritingTo(lines: string[]) {
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return pino({ level: 'info', redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, sink);
}

describe('logger redaction', () => {
  it('redacts secret-bearing fields and never prints their values', () => {
    const lines: string[] = [];
    const log = loggerWritingTo(lines);
    log.info({
      secret: 'top-secret-value',
      RAZORPAY_KEY_SECRET: 'rzp_key_secret',
      nested: { token: 'bearer-xyz' },
      ok: 'visible',
    });
    const output = lines.join('');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('top-secret-value');
    expect(output).not.toContain('rzp_key_secret');
    expect(output).not.toContain('bearer-xyz');
    expect(output).toContain('visible');
  });

  it('creates a named logger without throwing', () => {
    expect(() => createLogger({ name: 'moneytrace-test', level: 'silent' })).not.toThrow();
  });
});
