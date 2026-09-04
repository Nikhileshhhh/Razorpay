import { describe, expect, it } from 'vitest';
import {
  assertReplayTopicAllowed,
  ReplayTopicForbiddenError,
} from '../../src/worker/outbox-dispatcher.js';

describe('outbox replay capability boundary', () => {
  it('hard-denies every effect-capable topic in replay mode', () => {
    for (const topic of [
      'dispatch-action.v1',
      'reconcile-expectation.v1',
      'advance-demo-scenario.v1',
    ]) {
      expect(() => assertReplayTopicAllowed(topic, true)).toThrow(ReplayTopicForbiddenError);
    }
    expect(() => assertReplayTopicAllowed('project-evidence.v1', true)).not.toThrow();
    expect(() => assertReplayTopicAllowed('evaluate-controls.v1', true)).not.toThrow();
  });
});
