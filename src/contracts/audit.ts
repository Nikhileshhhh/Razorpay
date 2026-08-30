import { z } from 'zod';
import { boundedString, LIMITS } from './common/limits.js';
import { OpaqueId, Sha256Hash, TenantId } from './common/identifiers.js';
import { Role } from './common/roles.js';
import { Rfc3339Utc } from './common/timestamps.js';
import { ContractVersion, SchemaVersion } from './common/versions.js';

/**
 * Append-only audit record (FR-AUD-001, handoff §14). References only — no raw
 * payloads, secrets, or PII. Hashes and version references make a run replayable.
 */
export const ArtifactType = z.enum([
  'EVIDENCE',
  'INVESTIGATION',
  'FINDING',
  'POLICY_DECISION',
  'APPROVAL',
  'ACTION',
  'VERIFICATION',
  'RECONCILIATION',
  'CASE_TRANSITION',
  'MANUAL_LINK',
  'ADMIN_CHANGE',
]);
export type ArtifactType = z.infer<typeof ArtifactType>;

export const AuditActor = z.object({ actor_id: OpaqueId, actor_role: Role }).strict();

export const AuditRecord = z
  .object({
    schema_version: SchemaVersion,
    audit_sequence: z.number().int().min(0),
    tenant_id: TenantId,
    artifact_type: ArtifactType,
    artifact_id: OpaqueId,
    artifact_hash: Sha256Hash.nullable(),
    actor: AuditActor.nullable(),
    model_id: boundedString(LIMITS.ID_MAX).nullish(),
    prompt_version: boundedString(LIMITS.CODE_MAX).nullish(),
    evidence_set_hash: Sha256Hash.nullish(),
    policy_bundle_version: ContractVersion.nullish(),
    created_at: Rfc3339Utc,
  })
  .strict();
export type AuditRecord = z.infer<typeof AuditRecord>;
