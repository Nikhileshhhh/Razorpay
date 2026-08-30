import { z } from 'zod';
import { isValidRfc3339Utc, RFC3339_UTC_PATTERN } from './calendar.js';

/**
 * Canonical timestamps are RFC3339 UTC instants (trailing `Z`, no offsets).
 * All times are UTC; the UI converts to a local zone only at its boundary
 * (handoff §2.5). The regex constrains the shape; the refine performs
 * CALENDAR-AWARE validation so impossible dates/times (e.g. `2026-02-30`,
 * `2026-08-25T25:00:00Z`) are rejected rather than silently normalized.
 */
export { RFC3339_UTC_PATTERN };

export const Rfc3339Utc = z
  .string()
  .regex(RFC3339_UTC_PATTERN)
  .refine(isValidRfc3339Utc, { message: 'invalid RFC3339 UTC instant' });
export type Rfc3339Utc = z.infer<typeof Rfc3339Utc>;
