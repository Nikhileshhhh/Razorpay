import { z } from 'zod';
import { RequestId } from './common/identifiers.js';
import { page } from './common/pagination.js';
import { ResourceVersion, SchemaVersion } from './common/versions.js';

/**
 * Top-level API response envelopes.
 *
 * Every top-level response carries `schema_version` and `request_id`. Mutating
 * responses additionally carry the resulting `resource_version` (optimistic
 * concurrency), which is distinct from the schema version.
 */
export const ApiResponse = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ schema_version: SchemaVersion, request_id: RequestId, data }).strict();

export const MutationResponse = <T extends z.ZodTypeAny>(data: T) =>
  z
    .object({
      schema_version: SchemaVersion,
      request_id: RequestId,
      resource_version: ResourceVersion,
      data,
    })
    .strict();

export const ListResponse = <T extends z.ZodTypeAny>(item: T) => ApiResponse(page(item));
