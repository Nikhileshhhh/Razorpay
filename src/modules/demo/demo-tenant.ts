import type { TenantContext } from '../identity/tenant-context.js';

export const REGISTERED_DEMO_TENANT_ID = 'ten_demo';

export class DemoTenantMismatchError extends Error {
  constructor() {
    super('operation is restricted to the registered synthetic demo tenant');
    this.name = 'DemoTenantMismatchError';
  }
}

/**
 * The prototype intentionally owns one deterministic synthetic tenant. Make
 * that limitation an explicit service-boundary check instead of silently
 * redirecting another tenant's command to `ten_demo`.
 */
export function assertRegisteredDemoTenant(ctx: TenantContext): void {
  if (
    ctx.tenantId !== REGISTERED_DEMO_TENANT_ID ||
    (ctx.environment !== 'demo' && ctx.environment !== 'buildathon')
  ) {
    throw new DemoTenantMismatchError();
  }
}
