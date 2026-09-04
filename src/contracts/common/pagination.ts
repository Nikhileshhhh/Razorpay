import { z } from 'zod';
import { boundedArray, boundedString, LIMITS } from './limits.js';

/**
 * Cursor pagination. Public list routes use an opaque cursor and a bounded
 * limit; responses carry a `page_info` with the next cursor and a `has_more`
 * flag (handoff §10).
 */
export const PaginationQuery = z
  .object({
    cursor: boundedString(LIMITS.KEY_MAX).optional(),
    // Fastify supplies URL query values as strings. Coercion happens inside
    // the shared bounded contract so `?limit=3` is validated consistently by
    // every list route instead of being rejected as a non-number.
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
export type PaginationQuery = z.infer<typeof PaginationQuery>;

export const PageInfo = z
  .object({
    next_cursor: boundedString(LIMITS.KEY_MAX).nullable(),
    has_more: z.boolean(),
  })
  .strict();
export type PageInfo = z.infer<typeof PageInfo>;

/** Wrap an item schema into a bounded page (items + page_info). */
export const page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: boundedArray(item, LIMITS.LIST_ITEMS_MAX), page_info: PageInfo }).strict();
