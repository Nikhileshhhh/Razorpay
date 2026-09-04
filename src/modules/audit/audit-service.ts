import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../config/db.js';
import { auditEntries } from '../../config/db-schema.js';
import { contentHash } from '../../config/hashing.js';
import type { TenantContext } from '../identity/tenant-context.js';
import type { AuditRecord, ArtifactType } from '../../contracts/audit.js';
import type { Role } from '../../contracts/common/roles.js';

/** Roles that may see the actor identity on an audit record; everyone else gets it redacted. */
const ACTOR_VISIBLE_ROLES: ReadonlySet<Role> = new Set(['auditor', 'platform_operator']);

export class InvalidAuditCursorError extends Error {
  constructor() {
    super('invalid audit cursor');
    this.name = 'InvalidAuditCursorError';
  }
}

function decodeCursor(cursor: string | undefined): bigint | null {
  if (!cursor) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new InvalidAuditCursorError();
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return BigInt(decoded);
  } catch {
    throw new InvalidAuditCursorError();
  }
}

function encodeCursor(auditSequence: bigint): string {
  return Buffer.from(auditSequence.toString(), 'utf8').toString('base64url');
}

function toAuditRecord(
  row: typeof auditEntries.$inferSelect,
  viewerRoles: readonly Role[],
): AuditRecord {
  const canSeeActor = viewerRoles.some((r) => ACTOR_VISIBLE_ROLES.has(r));
  return {
    schema_version: '1.0',
    audit_sequence: Number(row.auditSequence),
    tenant_id: row.tenantId,
    artifact_type: row.artifactType as ArtifactType,
    artifact_id: row.artifactId,
    artifact_hash: (row.artifactHash as AuditRecord['artifact_hash']) ?? null,
    actor:
      canSeeActor && row.actorId && row.actorRole
        ? { actor_id: row.actorId, actor_role: row.actorRole as Role }
        : null,
    model_id: row.modelId,
    prompt_version: row.promptVersion,
    evidence_set_hash: (row.evidenceSetHash as AuditRecord['evidence_set_hash']) ?? null,
    policy_bundle_version: row.policyBundleVersion,
    created_at: row.createdAt.toISOString(),
  };
}

export interface ListCaseAuditInput {
  readonly caseId: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly artifactType?: ArtifactType;
  readonly viewerRoles: readonly Role[];
}

export interface ListCaseAuditResult {
  readonly items: readonly AuditRecord[];
  readonly nextCursor: string | null;
}

/**
 * Cursor audit replay for a case (backend PRD §14.1), tenant-scoped and
 * ordered by the tenant's monotonic audit sequence (never client timestamp
 * sorting). Case scoping follows the existing convention: `details->>'case_id'`
 * embedded by every case-scoped B1-B4 writer, since `audit_entries` has no
 * dedicated `case_id` column.
 */
export async function listCaseAudit(
  db: DbExecutor,
  ctx: TenantContext,
  input: ListCaseAuditInput,
): Promise<ListCaseAuditResult> {
  const limit = Math.min(input.limit ?? 50, 200);
  const after = decodeCursor(input.cursor);
  const conditions = [
    eq(auditEntries.tenantId, ctx.tenantId),
    sql`${auditEntries.details}->>'case_id' = ${input.caseId}`,
  ];
  if (after !== null) conditions.push(gt(auditEntries.auditSequence, after));
  if (input.artifactType) conditions.push(eq(auditEntries.artifactType, input.artifactType));

  const rows = await db
    .select()
    .from(auditEntries)
    .where(and(...conditions))
    .orderBy(asc(auditEntries.auditSequence))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit && page.length > 0
      ? encodeCursor(page[page.length - 1]!.auditSequence)
      : null;
  return { items: page.map((r) => toAuditRecord(r, input.viewerRoles)), nextCursor };
}

export interface AuditExportBundle {
  readonly generatedAt: string;
  readonly contentSha256: string;
  readonly entries: readonly AuditRecord[];
}

/**
 * Build the redacted JSON audit export bundle server-side from persisted rows
 * (backend PRD §14.2). The content hash is computed over the canonical export
 * content WITHOUT this field, so it can be safely echoed in BOTH the body and
 * the `x-moneytrace-content-sha256` response header.
 */
export async function buildCaseAuditExport(
  db: DbExecutor,
  ctx: TenantContext,
  caseId: string,
  viewerRoles: readonly Role[],
  now: Date = new Date(),
): Promise<AuditExportBundle> {
  const rows = await db
    .select()
    .from(auditEntries)
    .where(
      and(
        eq(auditEntries.tenantId, ctx.tenantId),
        sql`${auditEntries.details}->>'case_id' = ${caseId}`,
      ),
    )
    .orderBy(asc(auditEntries.auditSequence));

  const entries = rows.map((r) => toAuditRecord(r, viewerRoles));
  const generatedAt = now.toISOString();
  const contentSha256 = contentHash({ case_id: caseId, generated_at: generatedAt, entries });
  return { generatedAt, contentSha256, entries };
}
