import { and, asc, desc, eq, gt, gte, ilike, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { cases, economicSubjects, financialOutcomes } from '../../config/db-schema.js';
import type { TenantContext } from '../identity/tenant-context.js';
import type { CaseSummary } from '../../contracts/cases.js';

export type CaseSort =
  '-exposure_amount_minor' | 'exposure_amount_minor' | '-opened_at' | 'opened_at';

export interface ListCasesFilter {
  readonly state?: string;
  readonly controlId?: string;
  readonly minExposureMinor?: bigint;
  readonly maxExposureMinor?: bigint;
  readonly evidenceCoverage?: string;
  readonly ownerId?: string;
  readonly policyStatus?: string;
  readonly query?: string;
  readonly sort?: CaseSort;
  readonly cursor?: string;
  readonly limit: number;
}

export interface CasePage {
  readonly items: readonly CaseSummary[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export class InvalidCaseCursorError extends Error {
  constructor() {
    super('invalid case cursor');
    this.name = 'InvalidCaseCursorError';
  }
}

interface CaseCursor {
  readonly sort: CaseSort;
  readonly value: string;
  readonly id: string;
}

function decodeCursor(cursor: string | undefined, sort: CaseSort): CaseCursor | null {
  if (!cursor) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new InvalidCaseCursorError();
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Object.keys(parsed).sort().join(',') !== 'id,sort,value'
    ) {
      throw new InvalidCaseCursorError();
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      candidate.sort !== sort ||
      typeof candidate.value !== 'string' ||
      candidate.value.length === 0 ||
      typeof candidate.id !== 'string' ||
      candidate.id.length === 0
    ) {
      throw new InvalidCaseCursorError();
    }
    return candidate as unknown as CaseCursor;
  } catch (error) {
    if (error instanceof InvalidCaseCursorError) throw error;
    throw new InvalidCaseCursorError();
  }
}

function encodeCursor(cursor: CaseCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function toCaseSummary(row: typeof cases.$inferSelect, outcomeStatus: string | null): CaseSummary {
  return {
    schema_version: '1.0',
    case_id: row.id,
    case_dedupe_key: row.caseDedupeKey,
    tenant_id: row.tenantId,
    subject_id: row.subjectId,
    expectation_id: row.expectationId,
    control_id: row.controlId,
    epoch: row.epoch,
    lifecycle_state: row.lifecycleState as CaseSummary['lifecycle_state'],
    outcome_status: (outcomeStatus ?? 'EXPECTED') as CaseSummary['outcome_status'],
    exposure: { amount_minor: row.exposureAmountMinor.toString(), currency: 'INR' },
    priority_score: Number(row.priorityScore),
    evidence_coverage: row.evidenceCoverage as CaseSummary['evidence_coverage'],
    contradiction_count: row.contradictionCount,
    owner_id: row.ownerId,
    opened_at: row.openedAt.toISOString(),
    due_at: row.dueAt ? row.dueAt.toISOString() : null,
    closed_at: row.closedAt ? row.closedAt.toISOString() : null,
    resource_version: row.version,
  };
}

export async function listCases(
  db: Database,
  ctx: TenantContext,
  filter: ListCasesFilter,
): Promise<CasePage> {
  const sort = filter.sort ?? '-exposure_amount_minor';
  const cursor = decodeCursor(filter.cursor, sort);
  const conditions: SQL<unknown>[] = [
    eq(cases.tenantId, ctx.tenantId),
    eq(cases.isActiveEpoch, true),
  ];
  if (filter.state) conditions.push(eq(cases.lifecycleState, filter.state));
  if (filter.controlId) conditions.push(eq(cases.controlId, filter.controlId));
  if (filter.ownerId) conditions.push(eq(cases.ownerId, filter.ownerId));
  if (filter.evidenceCoverage) conditions.push(eq(cases.evidenceCoverage, filter.evidenceCoverage));
  if (filter.minExposureMinor != null)
    conditions.push(gte(cases.exposureAmountMinor, filter.minExposureMinor));
  if (filter.maxExposureMinor != null)
    conditions.push(lte(cases.exposureAmountMinor, filter.maxExposureMinor));
  if (filter.query) {
    const pattern = `${filter.query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    conditions.push(or(ilike(cases.id, pattern), ilike(economicSubjects.subjectKey, pattern))!);
  }
  if (filter.policyStatus) {
    conditions.push(sql`${filter.policyStatus} = (
      select pd.decision from policy_decisions pd
      where pd.tenant_id = ${cases.tenantId} and pd.case_id = ${cases.id}
      order by pd.created_at desc, pd.id desc limit 1
    )`);
  }
  if (cursor) conditions.push(cursorCondition(cursor));

  const order =
    sort === '-exposure_amount_minor'
      ? [desc(cases.exposureAmountMinor), asc(cases.id)]
      : sort === 'exposure_amount_minor'
        ? [asc(cases.exposureAmountMinor), asc(cases.id)]
        : sort === '-opened_at'
          ? [desc(cases.openedAt), asc(cases.id)]
          : [asc(cases.openedAt), asc(cases.id)];

  const rows = await db
    .select({ caseRow: cases, outcomeStatus: financialOutcomes.status })
    .from(cases)
    .innerJoin(
      economicSubjects,
      and(eq(economicSubjects.tenantId, cases.tenantId), eq(economicSubjects.id, cases.subjectId)),
    )
    .leftJoin(
      financialOutcomes,
      and(
        eq(financialOutcomes.tenantId, cases.tenantId),
        eq(financialOutcomes.expectationId, cases.expectationId),
        eq(financialOutcomes.isCurrent, true),
      ),
    )
    .where(and(...conditions))
    .orderBy(...order)
    .limit(filter.limit + 1);

  const hasMore = rows.length > filter.limit;
  const page = rows.slice(0, filter.limit);
  const last = page.at(-1)?.caseRow;
  return {
    items: page.map((row) => toCaseSummary(row.caseRow, row.outcomeStatus)),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            sort,
            value: sort.includes('exposure')
              ? last.exposureAmountMinor.toString()
              : last.openedAt.toISOString(),
            id: last.id,
          })
        : null,
    hasMore,
  };
}

function cursorCondition(cursor: CaseCursor): SQL<unknown> {
  if (cursor.sort.includes('exposure')) {
    let value: bigint;
    try {
      value = BigInt(cursor.value);
    } catch {
      throw new InvalidCaseCursorError();
    }
    return cursor.sort.startsWith('-')
      ? or(
          lt(cases.exposureAmountMinor, value),
          and(eq(cases.exposureAmountMinor, value), gt(cases.id, cursor.id)),
        )!
      : or(
          gt(cases.exposureAmountMinor, value),
          and(eq(cases.exposureAmountMinor, value), gt(cases.id, cursor.id)),
        )!;
  }
  const value = new Date(cursor.value);
  if (Number.isNaN(value.getTime()) || value.toISOString() !== cursor.value) {
    throw new InvalidCaseCursorError();
  }
  return cursor.sort.startsWith('-')
    ? or(lt(cases.openedAt, value), and(eq(cases.openedAt, value), gt(cases.id, cursor.id)))!
    : or(gt(cases.openedAt, value), and(eq(cases.openedAt, value), gt(cases.id, cursor.id)))!;
}

export async function getCaseSummary(
  db: Database,
  ctx: TenantContext,
  caseId: string,
): Promise<CaseSummary | null> {
  const rows = await db
    .select({ caseRow: cases, outcomeStatus: financialOutcomes.status })
    .from(cases)
    .leftJoin(
      financialOutcomes,
      and(
        eq(financialOutcomes.tenantId, cases.tenantId),
        eq(financialOutcomes.expectationId, cases.expectationId),
        eq(financialOutcomes.isCurrent, true),
      ),
    )
    .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.id, caseId)))
    .limit(1);
  const row = rows[0];
  return row ? toCaseSummary(row.caseRow, row.outcomeStatus) : null;
}

export async function countCases(db: Database, ctx: TenantContext): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cases)
    .where(and(eq(cases.tenantId, ctx.tenantId), eq(cases.isActiveEpoch, true)));
  return rows[0]?.count ?? 0;
}
