import type { Env } from '../../config/env.js';
import { DemoInvestigationGateway } from './demo-gateway.js';
import { ExternalModelGateway } from './external-gateway.js';
import type { ModelGateway } from './model-gateway.js';

/**
 * Select the investigation gateway from environment configuration (backend
 * PRD §11.1/§11.2). `MODEL_PROVIDER=stub` (the default) always selects the
 * required deterministic offline gateway. An external provider is used ONLY
 * when explicitly configured with both an API URL and key; if either is
 * missing, this safely falls back to the deterministic gateway rather than
 * failing startup — no paid API is ever required.
 */
export function createModelGateway(
  env: Pick<Env, 'MODEL_PROVIDER'> & { MODEL_API_URL?: string; MODEL_API_KEY?: string },
): ModelGateway {
  if (env.MODEL_PROVIDER === 'external' && env.MODEL_API_URL && env.MODEL_API_KEY) {
    return new ExternalModelGateway({ apiUrl: env.MODEL_API_URL, apiKey: env.MODEL_API_KEY });
  }
  return new DemoInvestigationGateway();
}
