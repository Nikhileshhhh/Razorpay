import type { Database } from '../../config/db.js';
import type { SourceSystem } from '../../contracts/events/event-types.js';
import { resolveSourceTenant, verifyHmacSha256 } from '../ingestion/source-auth.js';
import type { TenantContext } from './tenant-context.js';

/**
 * Branded connector identity, returned ONLY after a real source-account lookup
 * and exact-byte HMAC verification. It cannot be constructed from a request
 * header, job payload, or a "connector" role claimed by a demo user — a client
 * asserting `tenant_id` in a connector-authenticated body is only checked
 * against this resolved tenant, never trusted to establish it.
 */
const connectorBrand: unique symbol = Symbol('moneytrace.connector-principal');

export interface ConnectorPrincipal {
  readonly kind: 'connector';
  readonly sourceSystem: SourceSystem;
  readonly tenantContext: TenantContext;
  readonly [connectorBrand]: true;
}

export class ConnectorAuthenticationError extends Error {
  constructor() {
    super('source authentication failed: unknown account or invalid signature');
    this.name = 'ConnectorAuthenticationError';
  }
}

export interface AuthenticateConnectorInput {
  readonly sourceSystem: SourceSystem;
  readonly externalAccountId: string;
  readonly rawBytes: Buffer;
  readonly providedSignature: string | undefined;
  readonly secret: string;
}

/**
 * Authenticate a synthetic connector: exact-byte HMAC-SHA256 verification
 * BEFORE any parsing, then a real `source_connections` lookup for the tenant.
 * Both must succeed before a {@link ConnectorPrincipal} is returned.
 */
export async function authenticateConnector(
  db: Database,
  input: AuthenticateConnectorInput,
): Promise<ConnectorPrincipal> {
  if (!verifyHmacSha256(input.rawBytes, input.providedSignature, input.secret)) {
    throw new ConnectorAuthenticationError();
  }
  const tenantContext = await resolveSourceTenant(db, input.sourceSystem, input.externalAccountId);
  if (!tenantContext) throw new ConnectorAuthenticationError();
  return {
    kind: 'connector',
    sourceSystem: input.sourceSystem,
    tenantContext,
    [connectorBrand]: true as const,
  };
}
