import { canonicalJsonStringify, sha256Hex } from '../../config/hashing.js';

/**
 * Fallback dedupe key (architecture handoff §8.3, backend PRD §9.1): used when
 * a source provides no `source_event_id`. Includes source/entity/type/event
 * time/raw hash so it never merges two DISTINCT events that happen to share an
 * amount — only an exact repeat of the same evidence collapses.
 */
export interface FallbackDedupeInput {
  readonly tenantId: string;
  readonly sourceSystem: string;
  readonly entityId: string | null;
  readonly sourceEventType: string;
  readonly eventTimeIso: string;
  readonly payloadHash: string;
}

export function computeFallbackDedupeKey(input: FallbackDedupeInput): string {
  return sha256Hex(
    canonicalJsonStringify({
      tenantId: input.tenantId,
      sourceSystem: input.sourceSystem,
      entityId: input.entityId,
      sourceEventType: input.sourceEventType,
      eventTimeIso: input.eventTimeIso,
      payloadHash: input.payloadHash,
    }),
  );
}

/** Pick a representative entity id from the canonical event's references. */
export function primaryEntityReference(
  entityReferences: Readonly<Record<string, string | null | undefined>>,
): string | null {
  for (const value of Object.values(entityReferences)) {
    if (value) return value;
  }
  return null;
}
