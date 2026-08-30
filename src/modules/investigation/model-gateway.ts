import type { ModelInvestigationOutput } from '../../contracts/findings.js';
import type { CaseEvidencePool } from './evidence-classification.js';

/**
 * Provider-neutral investigation gateway (backend PRD §11, architecture §12).
 *
 * A gateway receives ONLY the sealed, typed, tenant-scoped evidence pool for
 * ONE case/control and returns an UNVALIDATED {@link ModelInvestigationOutput}
 * candidate. It must never see raw secrets, other tenants' data, or a tool
 * executor. The caller (investigation-service) is solely responsible for
 * schema/citation/enum validation and for injecting deterministic exposure —
 * a gateway implementation must never be trusted directly.
 */
export interface ModelGatewayRequest {
  readonly caseId: string;
  readonly controlId: string;
  readonly evidenceSetHash: string;
  readonly promptVersion: string;
  readonly pool: CaseEvidencePool;
}

export interface ModelGatewayResult {
  readonly output: ModelInvestigationOutput;
  readonly modelId: string;
  readonly modelConfigHash: string;
  readonly gatewayMode: 'offline_stub' | 'external_provider';
}

export class ModelGatewayTimeoutError extends Error {
  constructor() {
    super('model gateway call timed out');
    this.name = 'ModelGatewayTimeoutError';
  }
}

export class ModelGatewayUnavailableError extends Error {
  constructor(reason: string) {
    super(`model gateway unavailable: ${reason}`);
    this.name = 'ModelGatewayUnavailableError';
  }
}

export interface ModelGateway {
  readonly mode: 'offline_stub' | 'external_provider';
  investigate(request: ModelGatewayRequest): Promise<ModelGatewayResult>;
}
