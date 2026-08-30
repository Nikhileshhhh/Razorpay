import type { Database } from '../../config/db.js';
import type { TenantContext } from '../identity/tenant-context.js';
import { openOrGetCase } from '../cases/case-service.js';
import { money } from '../../domain/money/money.js';

export interface ControlCaseInput {
  readonly controlId: string;
  readonly subjectId: string;
  readonly expectationId: string;
  readonly expectationVersion: number;
  readonly evaluationWindow: string;
  readonly exposureAmountMinor: bigint;
  readonly harmRisk?: 'low' | 'medium' | 'high';
  readonly ageSeconds?: number;
}

export async function openControlCase(db: Database, ctx: TenantContext, input: ControlCaseInput) {
  return openOrGetCase(db, ctx, {
    controlId: input.controlId,
    subjectId: input.subjectId,
    expectationId: input.expectationId,
    expectationVersion: input.expectationVersion,
    evaluationWindow: input.evaluationWindow,
    exposure: money(input.exposureAmountMinor),
    priority: {
      exposure: money(input.exposureAmountMinor),
      evidenceCoverage: 'complete',
      customerHarmRisk: input.harmRisk ?? 'high',
      ageSeconds: input.ageSeconds ?? 0,
    },
  });
}

export function references(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function rawData(value: unknown): Record<string, unknown> {
  const payload = references(value);
  return references(payload.data);
}
