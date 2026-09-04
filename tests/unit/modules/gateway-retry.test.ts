import { describe, expect, it } from 'vitest';
import { callGatewayWithRetry } from '../../../src/modules/investigation/investigation-service.js';
import {
  ModelGatewayTimeoutError,
  ModelGatewayUnavailableError,
  type ModelGateway,
  type ModelGatewayRequest,
} from '../../../src/modules/investigation/model-gateway.js';

const request = {
  caseId: 'case_retry',
  controlId: 'CTRL-01',
  evidenceSetHash: `sha256:${'a'.repeat(64)}`,
  promptVersion: 'v1',
  pool: { caseId: 'case_retry', subjectId: 'subject_retry', subjectKey: 'order:retry', items: [] },
} satisfies ModelGatewayRequest;

function failingGateway(errorFactory: () => Error, attempts: { count: number }): ModelGateway {
  return {
    mode: 'external_provider',
    async investigate() {
      attempts.count += 1;
      throw errorFactory();
    },
  };
}

describe('external model gateway retry bounds', () => {
  it.each([
    ['timeout', () => new ModelGatewayTimeoutError()],
    ['unavailable', () => new ModelGatewayUnavailableError('test-only')],
  ] as const)('tries %s failures at most twice', async (_name, factory) => {
    const attempts = { count: 0 };
    await expect(
      callGatewayWithRetry(failingGateway(factory, attempts), request),
    ).resolves.toBeNull();
    expect(attempts.count).toBe(2);
  });

  it('does not retry an unclassified provider exception', async () => {
    const attempts = { count: 0 };
    await expect(
      callGatewayWithRetry(
        failingGateway(() => new Error('test-only'), attempts),
        request,
      ),
    ).resolves.toBeNull();
    expect(attempts.count).toBe(1);
  });
});
