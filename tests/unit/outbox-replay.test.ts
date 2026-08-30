import { describe, expect, it } from 'vitest';
import {
  assertReplayTopicAllowed,
  ReplayTopicForbiddenError,
} from '../../src/worker/outbox-dispatcher.js';

describe('outbox replay capability boundary', () => {
  it('hard-denies the only action-capable topic in replay mode', () => {
    expect(() => assertReplayTopicAllowed('dispatch-action.v1', true)).toThrow(
      ReplayTopicForbiddenError,
    );
    expect(() => assertReplayTopicAllowed('project-evidence.v1', true)).not.toThrow();
    expect(() => assertReplayTopicAllowed('evaluate-controls.v1', true)).not.toThrow();
  });
});
