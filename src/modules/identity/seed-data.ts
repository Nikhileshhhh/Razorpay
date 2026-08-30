import type { Role } from './roles.js';

/**
 * Deterministic identity seed data (backend PRD §6.1, §6.2). `ten_demo` is the
 * primary demo tenant; `ten_other` exists ONLY for cross-tenant negative tests
 * and is never used by the four required scenarios.
 */
export interface SeedTenant {
  readonly id: string;
  readonly displayName: string;
  readonly environment: string;
}

export interface SeedUser {
  readonly id: string;
  readonly tenantId: string;
  readonly displayName: string;
  readonly roles: readonly Role[];
}

export const SEED_TENANTS: readonly SeedTenant[] = [
  { id: 'ten_demo', displayName: 'MoneyTrace Demo Tenant', environment: 'demo' },
  { id: 'ten_other', displayName: 'Cross-Tenant Negative-Test Tenant', environment: 'demo' },
];

export const SEED_USERS: readonly SeedUser[] = [
  {
    id: 'user_viewer',
    tenantId: 'ten_demo',
    displayName: 'Demo Viewer',
    roles: ['viewer'],
  },
  {
    id: 'user_investigator',
    tenantId: 'ten_demo',
    displayName: 'Demo Investigator',
    roles: ['viewer', 'investigator', 'case_manager'],
  },
  {
    id: 'user_approver',
    tenantId: 'ten_demo',
    displayName: 'Demo Approver',
    roles: ['viewer', 'finance_approver'],
  },
  {
    id: 'user_operator',
    tenantId: 'ten_demo',
    displayName: 'Demo Operator',
    roles: ['viewer', 'executor', 'demo_operator', 'platform_operator', 'auditor'],
  },
  {
    id: 'user_other_viewer',
    tenantId: 'ten_other',
    displayName: 'Other-Tenant Viewer (negative tests only)',
    roles: ['viewer'],
  },
];
