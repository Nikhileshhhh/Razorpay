import { describe, expect, it } from 'vitest';
import { ErrorCode, ErrorEnvelope } from '../../../src/contracts/errors.js';

const envelope = (over: Record<string, unknown> = {}) => ({
  schema_version: '1.0',
  error: {
    code: 'EVIDENCE_CONFLICT',
    message: 'The case cannot be resolved with the current evidence.',
    request_id: 'req_123',
    retryable: false,
    details: {
      kind: 'conflicting_evidence',
      conflicting_evidence_ids: ['ev_bank_22', 'ev_settlement_14'],
    },
    ...over,
  },
});

describe('error model', () => {
  it('enumerates exactly the documented error codes (MT-002 + backend PRD §14.3 additions)', () => {
    expect([...ErrorCode.options].sort()).toEqual(
      [
        'TENANT_SCOPE_REQUIRED',
        'SCHEMA_INVALID',
        'EVIDENCE_CONFLICT',
        'VERSION_CONFLICT',
        'POLICY_DENIED',
        'APPROVAL_STALE',
        'APPROVAL_FORBIDDEN',
        'IDEMPOTENCY_BODY_CONFLICT',
        'AGENT_ATTRIBUTION_CONFLICT',
        'OUTCOME_UNKNOWN',
        'CURRENCY_MISMATCH',
        'RECONCILIATION_AMBIGUOUS',
        'VERIFICATION_INCOMPLETE',
        'OUTCOME_TRANSITION_FORBIDDEN',
        'NOT_FOUND',
        'SOURCE_UNAVAILABLE',
        'RATE_LIMITED',
      ].sort(),
    );
    for (const c of ErrorCode.options) expect(ErrorCode.parse(c)).toBe(c);
    expect(ErrorCode.safeParse('SOMETHING_ELSE').success).toBe(false);
  });

  it('requires schema_version and preserves request_id + typed details', () => {
    expect(ErrorEnvelope.parse(envelope()).schema_version).toBe('1.0');
    const { schema_version: _s, ...rest } = envelope();
    expect(ErrorEnvelope.safeParse(rest).success).toBe(false);
    expect(ErrorEnvelope.safeParse({ ...envelope(), schema_version: '2.0' }).success).toBe(false);
  });

  it('accepts the "none" details variant', () => {
    expect(
      ErrorEnvelope.parse({
        schema_version: '1.0',
        error: {
          code: 'SCHEMA_INVALID',
          message: 'bad',
          request_id: 'req_1',
          retryable: false,
          details: { kind: 'none' },
        },
      }).error.details.kind,
    ).toBe('none');
  });

  it('rejects an arbitrary details object (no free-form / secret-carrying details)', () => {
    for (const details of [
      { kind: 'conflicting_evidence', conflicting_evidence_ids: ['ev_1'], raw_payload: 'secret' },
      { kind: 'unknown_kind', anything: 'x' },
      { raw: { sql: 'DROP TABLE x' } },
    ]) {
      expect(ErrorEnvelope.safeParse(envelope({ details })).success).toBe(false);
    }
  });
});
