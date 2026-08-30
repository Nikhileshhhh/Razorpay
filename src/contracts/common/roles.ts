import { z } from 'zod';

/**
 * Shared control-plane enums used by policy, approvals, and audit. Placed in a
 * neutral module so those leaves can import them without creating an import
 * cycle between one another.
 */

/** Authorization roles (PRD §21.3 plus the API roles named in handoff §10). */
export const Role = z.enum([
  'viewer',
  'investigator',
  'case_manager',
  'finance_approver',
  'policy_administrator',
  'auditor',
  'platform_operator',
  'connector',
  'executor',
  'worker',
  'demo_operator',
]);
export type Role = z.infer<typeof Role>;

/** MoneyTrace runtime environment (mirrors the validated server env). */
export const RuntimeEnvironment = z.enum([
  'demo',
  'buildathon',
  'test',
  'development',
  'production',
]);
export type RuntimeEnvironment = z.infer<typeof RuntimeEnvironment>;

/** Coarse customer-impact classification used as a policy input. */
export const CustomerImpact = z.enum(['none', 'low', 'medium', 'high']);
export type CustomerImpact = z.infer<typeof CustomerImpact>;
