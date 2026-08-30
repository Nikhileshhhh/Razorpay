import { z } from 'zod';
import { DATE_ONLY_PATTERN, isValidDateOnly } from './calendar.js';

/**
 * Opaque identifiers and format-constrained scalars.
 *
 * IDs are bounded and restricted to a safe character set, but NOT overfit to any
 * single future ID generator (they accept ULIDs, prefixed ids like `pay_…`, and
 * so on). Hashes and dates have explicit formats.
 */

/** Generic opaque id (e.g. `evt_01H…`, `order_718`, `ten_demo`). */
export const OpaqueId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
export type OpaqueId = z.infer<typeof OpaqueId>;

/** Subject/dedupe key; allows `:` segments (e.g. `order:merchant-order-718:seller-42`). */
export const SubjectKey = z.string().regex(/^[A-Za-z0-9._:-]{1,256}$/);
export type SubjectKey = z.infer<typeof SubjectKey>;

// Semantic aliases (all opaque). Kept as aliases so no generator shape is assumed.
export const RequestId = OpaqueId;
export const EventId = OpaqueId;
export const TenantId = OpaqueId;
export const CaseId = OpaqueId;
export const PlanId = OpaqueId;
export const ActionId = OpaqueId;
export const ApprovalId = OpaqueId;
export const EvidenceId = OpaqueId;
export const SubjectId = OpaqueId;
export const ExpectationId = OpaqueId;
export const EconomicSubjectHint = SubjectKey;

/** Content hash in the explicit `sha256:<64 lowercase hex>` form. */
export const Sha256Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export type Sha256Hash = z.infer<typeof Sha256Hash>;

/** Opaque reference to an immutable raw payload (e.g. `db:ingest_events/evt_01H…`). */
export const RawPayloadRef = z.string().regex(/^[A-Za-z0-9._:/-]{1,256}$/);

/** Bank UTR (bounded alphanumeric). */
export const Utr = z.string().regex(/^[A-Za-z0-9]{1,64}$/);

/** Calendar date `YYYY-MM-DD` (e.g. a bank value date); calendar-aware. */
export const DateOnly = z
  .string()
  .regex(DATE_ONLY_PATTERN)
  .refine(isValidDateOnly, { message: 'invalid calendar date' });
