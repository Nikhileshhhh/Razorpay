import { createHash } from 'node:crypto';

/**
 * Canonical JSON + SHA-256 hashing, shared across modules that need a
 * deterministic content hash (ingestion payload hashes, sealed evidence sets,
 * the demo manifest hash). Canonical JSON sorts object keys recursively so key
 * order never perturbs the hash.
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeysDeep(v)]));
  }
  return value;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** `sha256:<64 lowercase hex>` — matches the contract's Sha256Hash format. */
export function contentHash(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJsonStringify(value))}`;
}

/** Hash of exact raw bytes (webhook/import payloads) — never re-serialized. */
export function rawBytesHash(bytes: Buffer | string): string {
  return `sha256:${sha256Hex(bytes)}`;
}
