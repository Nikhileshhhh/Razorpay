import { z } from 'zod';

/**
 * Contract/schema versioning.
 *
 * `schema_version` is the wire-format version of a contract (bumped when a
 * schema's shape changes). It is deliberately distinct from `resource_version`,
 * the optimistic-concurrency version of a persisted resource. A missing, wrong,
 * or unknown schema version must reject — enforced by the literal below.
 */
export const CURRENT_SCHEMA_VERSION = '1.0';

export const SchemaVersion = z.literal(CURRENT_SCHEMA_VERSION);
export type SchemaVersion = z.infer<typeof SchemaVersion>;

/** Optimistic-concurrency version of a persisted resource (never a schema version). */
export const ResourceVersion = z.number().int().min(0);
export type ResourceVersion = z.infer<typeof ResourceVersion>;

/** Version identifier for a versioned bundle/contract (e.g. `moneytrace_demo_v1`). */
export const ContractVersion = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);
export type ContractVersion = z.infer<typeof ContractVersion>;
