import { contentHash } from '../../config/hashing.js';
import {
  ModelGatewayTimeoutError,
  ModelGatewayUnavailableError,
  type ModelGateway,
  type ModelGatewayRequest,
  type ModelGatewayResult,
} from './model-gateway.js';

/**
 * Optional external model provider adapter (backend PRD §11.2). Disabled by
 * default (`MODEL_PROVIDER=stub`); only constructed when BOTH `MODEL_API_URL`
 * and `MODEL_API_KEY` are explicitly configured. No paid API is required for
 * acceptance, and no vendor SDK is assumed — the provider is expected to
 * return JSON matching {@link ModelInvestigationOutput} directly. Any
 * network/timeout/parse failure throws a typed error the caller (the service
 * layer, which owns the ONE-retry policy) safely falls back to the
 * deterministic gateway for, never blocking ingestion or case creation.
 *
 * The request body carries ONLY the sealed evidence pool's typed fields
 * (evidence ids/types/references already redacted to entity_references) —
 * never raw secrets, other tenants' data, or a tool executor.
 */
export interface ExternalGatewayConfig {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
}

export class ExternalModelGateway implements ModelGateway {
  readonly mode = 'external_provider' as const;

  constructor(private readonly config: ExternalGatewayConfig) {}

  async investigate(request: ModelGatewayRequest): Promise<ModelGatewayResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 8000);
    try {
      const response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          case_id: request.caseId,
          control_id: request.controlId,
          evidence_set_hash: request.evidenceSetHash,
          prompt_version: request.promptVersion,
          evidence: request.pool.items.map((item) => ({
            evidence_id: item.evidenceId,
            evidence_type: item.evidenceType,
          })),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ModelGatewayUnavailableError(`http_${response.status}`);
      }
      const body: unknown = await response.json();
      return {
        output: body as ModelGatewayResult['output'],
        modelId: this.config.apiUrl,
        modelConfigHash: contentHash({ apiUrl: this.config.apiUrl }),
        gatewayMode: 'external_provider',
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ModelGatewayTimeoutError();
      }
      if (error instanceof ModelGatewayUnavailableError) throw error;
      throw new ModelGatewayUnavailableError('network_error');
    } finally {
      clearTimeout(timeout);
    }
  }
}
