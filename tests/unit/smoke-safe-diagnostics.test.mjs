import { describe, expect, it } from 'vitest';
import { buildSafeFailureReport, sanitizeReasonCode } from '../../scripts/lib/safe-diagnostics.mjs';

// Secret-shaped MARKERS (unmistakably fake) that the smoke check might capture
// from a misbehaving child. The failure report must never echo any of them.
const CAPTURED_WITH_SECRETS = [
  'postgres://TEST_ONLY_USER:TEST_ONLY_PASSWORD_MARKER@db.invalid:5432/x',
  'Bearer TEST_ONLY_TOKEN_MARKER',
  'rzp_test_FAKE_TEST_ONLY',
  'TEST_ONLY_HMAC_SECRET_MARKER',
].join('\n');

const SECRET_MARKERS = [
  'TEST_ONLY_PASSWORD_MARKER',
  'TEST_ONLY_TOKEN_MARKER',
  'rzp_test_FAKE_TEST_ONLY',
  'TEST_ONLY_HMAC_SECRET_MARKER',
];

describe('buildSafeFailureReport', () => {
  it('never includes captured stdout/stderr content, only that it was non-empty', () => {
    const report = buildSafeFailureReport({
      reasonCode: 'SECRET_IN_CHILD_OUTPUT',
      exitCode: 1,
      signal: null,
      stdout: CAPTURED_WITH_SECRETS,
      stderr: CAPTURED_WITH_SECRETS,
      elapsedMs: 1234,
    });
    for (const marker of SECRET_MARKERS) {
      expect(report).not.toContain(marker);
    }
    expect(report).toContain('reason=SECRET_IN_CHILD_OUTPUT');
    expect(report).toContain('exitCode=1');
    expect(report).toContain('stdoutNonEmpty=true');
    expect(report).toContain('stderrNonEmpty=true');
    expect(report).toContain('elapsedMs=1234');
  });

  it('reports empty streams as non-empty=false and omits their content', () => {
    const report = buildSafeFailureReport({
      reasonCode: 'HEALTH_TIMEOUT',
      exitCode: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: '',
      elapsedMs: 20000,
    });
    expect(report).toBe(
      'reason=HEALTH_TIMEOUT exitCode=null signal=SIGTERM stdoutNonEmpty=false stderrNonEmpty=false elapsedMs=20000',
    );
  });

  it('sanitizes a reason code that itself carries secret-shaped text', () => {
    expect(sanitizeReasonCode('rzp_test_FAKE_TEST_ONLY leak')).toBe('UNKNOWN');
    expect(sanitizeReasonCode('SECRET_IN_CHILD_OUTPUT')).toBe('SECRET_IN_CHILD_OUTPUT');
    const report = buildSafeFailureReport({
      reasonCode: 'rzp_test_FAKE_TEST_ONLY',
      stdout: CAPTURED_WITH_SECRETS,
    });
    for (const marker of SECRET_MARKERS) {
      expect(report).not.toContain(marker);
    }
    expect(report).toContain('reason=UNKNOWN');
  });

  it('rejects a non-signal string and a non-integer exit code', () => {
    const report = buildSafeFailureReport({
      reasonCode: 'API_EXITED_EARLY',
      exitCode: 'not-a-number',
      signal: 'not-a-signal',
    });
    expect(report).toContain('exitCode=null');
    expect(report).toContain('signal=null');
  });
});
