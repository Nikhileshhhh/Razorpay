import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DatabaseTransaction } from '../../config/db.js';
import { auditEntries } from '../../config/db-schema.js';
import type { TenantContext } from '../identity/tenant-context.js';
import type { ArtifactType } from '../../contracts/audit.js';
import type { Role } from '../../contracts/common/roles.js';
import { canonicalJsonStringify } from '../../config/hashing.js';

/**
 * Allowlisted safe detail shapes per Gate B4 artifact type (backend PRD §18,
 * architecture §14). Never a raw payload, header, provider error, URL, or
 * credential — only stable identifiers and enums that a redacted read/export
 * can safely surface. `case_id` follows the existing B1-B3 convention (see
 * `case-service.ts`/`action-service.ts`): case-scoped audit is queried by this
 * embedded field, not a dedicated `audit_entries.case_id` column.
 */
export type AuditDetails =
  | {
      readonly operation: 'agent_claim_accepted';
      readonly claim_id: string;
      readonly idempotent_replay: boolean;
    }
  | {
      readonly operation: 'claim_evaluated';
      readonly claim_id: string;
      readonly status: string;
      readonly evaluation_version: number;
    }
  | {
      readonly operation: 'reconciliation_allocated';
      readonly case_id: string;
      readonly allocation_id: string;
      readonly expectation_id: string;
      readonly bank_line_evidence_id: string;
    }
  | {
      readonly operation: 'reconciliation_ambiguous';
      readonly case_id: string;
      readonly expectation_id: string;
      readonly candidate_count: number;
      readonly reason: 'multiple_candidates' | 'contested_bank_line' | null;
    }
  | {
      readonly operation: 'receivable_closed';
      readonly case_id: string;
      readonly allocation_id: string;
      readonly closure_evidence_id: string;
    }
  | {
      readonly operation: 'reconciliation_reversed';
      readonly case_id: string;
      readonly allocation_id: string;
      readonly new_case_epoch: number | null;
    }
  | {
      readonly operation: 'dataset_imported';
      readonly import_id: string;
      readonly accepted_count: number;
    }
  | { readonly operation: 'demo_reset'; readonly seed_id: string; readonly manifest_hash: string }
  | {
      readonly operation: 'demo_scenario_advanced';
      readonly scenario_id: string;
      readonly step: number;
    }
  | {
      readonly operation: 'verification_evaluated';
      readonly case_id: string;
      readonly action_id: string;
      readonly status: string;
      readonly version: number;
    };

export interface AppendAuditEntryInput {
  readonly artifactType: ArtifactType;
  readonly artifactId: string;
  readonly artifactHash?: string | null;
  readonly actorId: string | null;
  readonly actorRole: Role | 'worker';
  readonly details: AuditDetails;
  /** A deterministic id makes retry-repair idempotent (no duplicate audit row). */
  readonly deterministicId?: string;
}

export class AuditIdempotencyConflictError extends Error {
  constructor() {
    super('audit id already exists with different content');
    this.name = 'AuditIdempotencyConflictError';
  }
}

/**
 * Append one audit row in the CALLER's transaction (backend PRD §18: "if the
 * audit write required for an action cannot commit, the action must not
 * proceed"). This is the single writer B4 services use — never a raw payload,
 * header, or credential in `details`.
 */
export async function appendAuditEntry(
  tx: DatabaseTransaction,
  ctx: TenantContext,
  input: AppendAuditEntryInput,
): Promise<void> {
  const id = input.deterministicId ?? `audit_${randomUUID()}`;
  const value = {
    id,
    tenantId: ctx.tenantId,
    artifactType: input.artifactType,
    artifactId: input.artifactId,
    artifactHash: input.artifactHash ?? null,
    actorId: input.actorId,
    actorRole: input.actorRole,
    details: input.details,
  };
  const inserted = await tx.insert(auditEntries).values(value).onConflictDoNothing().returning({
    id: auditEntries.id,
  });
  if (inserted.length === 1 || !input.deterministicId) return;
  const existing = await tx
    .select()
    .from(auditEntries)
    .where(and(eq(auditEntries.tenantId, ctx.tenantId), eq(auditEntries.id, id)))
    .limit(1);
  const row = existing[0];
  if (
    !row ||
    row.artifactType !== value.artifactType ||
    row.artifactId !== value.artifactId ||
    row.artifactHash !== value.artifactHash ||
    row.actorId !== value.actorId ||
    row.actorRole !== value.actorRole ||
    canonicalJsonStringify(row.details) !== canonicalJsonStringify(value.details)
  ) {
    throw new AuditIdempotencyConflictError();
  }
}
