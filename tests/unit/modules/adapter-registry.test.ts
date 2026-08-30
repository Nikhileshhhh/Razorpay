import { describe, expect, it } from 'vitest';
import {
  dispatchThroughAdapter,
  NoAdapterRegisteredError,
} from '../../../src/modules/actions/adapter-registry.js';

describe('closed typed adapter registry (backend PRD §12.4/§17: simulated Route/recovery only)', () => {
  it('dispatches SIMULATE_TRANSFER_REMEDIATION through the synthetic Route adapter', () => {
    const result = dispatchThroughAdapter('SIMULATE_TRANSFER_REMEDIATION', {
      actionId: 'action_1',
    });
    expect(result.outcome).toBe('ACKNOWLEDGED');
    expect(result.externalReference).toBe('synthetic_route_action_1');
  });

  it('dispatches SUPPRESS_SIMULATED_RECOVERY through the synthetic recovery adapter', () => {
    const result = dispatchThroughAdapter('SUPPRESS_SIMULATED_RECOVERY', { actionId: 'action_2' });
    expect(result.outcome).toBe('ACKNOWLEDGED');
    expect(result.externalReference).toBe('synthetic_recovery_action_2');
  });

  it('produces a DETERMINISTIC external reference from actionId alone (crash-safe: same action -> same effect)', () => {
    const first = dispatchThroughAdapter('SIMULATE_TRANSFER_REMEDIATION', { actionId: 'action_3' });
    const second = dispatchThroughAdapter('SIMULATE_TRANSFER_REMEDIATION', {
      actionId: 'action_3',
    });
    expect(first.externalReference).toBe(second.externalReference);
  });

  it('has NO adapter for REQUEST_MORE_EVIDENCE (realized via the approval endpoint, not dispatch)', () => {
    expect(() => dispatchThroughAdapter('REQUEST_MORE_EVIDENCE', { actionId: 'action_4' })).toThrow(
      NoAdapterRegisteredError,
    );
  });

  it('has NO adapter for CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION (Gate B4 scope)', () => {
    expect(() =>
      dispatchThroughAdapter('CLOSE_SYNTHETIC_RECEIVABLE_AFTER_RECONCILIATION', {
        actionId: 'action_5',
      }),
    ).toThrow(NoAdapterRegisteredError);
  });

  it('supports forced outcomes for deterministic fault-injection testing (FAILED/OUTCOME_UNKNOWN)', () => {
    const failed = dispatchThroughAdapter('SIMULATE_TRANSFER_REMEDIATION', {
      actionId: 'action_6',
      forcedOutcome: 'FAILED',
    });
    expect(failed.outcome).toBe('FAILED');
    expect(failed.externalReference).toBeNull();

    const unknown = dispatchThroughAdapter('SIMULATE_TRANSFER_REMEDIATION', {
      actionId: 'action_7',
      forcedOutcome: 'OUTCOME_UNKNOWN',
    });
    expect(unknown.outcome).toBe('OUTCOME_UNKNOWN');
    expect(unknown.externalReference).toBe('synthetic_route_action_7');
  });
});
