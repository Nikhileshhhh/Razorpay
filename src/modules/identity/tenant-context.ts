/**
 * `TenantContext` (backend PRD §6.2): every tenant-owned repository method
 * requires this as its FIRST parameter. It is never trusted from client input
 * — it is always derived server-side from a resolved identity (demo header ->
 * DB lookup) or from a job/worker's own tenant-scoped payload.
 */
export interface TenantContext {
  readonly tenantId: string;
  readonly environment: string;
}

export function createTenantContext(tenantId: string, environment: string): TenantContext {
  if (!tenantId)
    throw new TenantScopeRequiredError('tenantId is required to build a TenantContext');
  return { tenantId, environment };
}

export class TenantScopeRequiredError extends Error {
  constructor(message = 'tenant scope is required') {
    super(message);
    this.name = 'TenantScopeRequiredError';
  }
}
