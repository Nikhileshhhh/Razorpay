import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../config/db.js';
import { economicSubjects, expectationInputs, expectations } from '../../config/db-schema.js';
import { contentHash } from '../../config/hashing.js';
import type { TenantContext } from '../identity/tenant-context.js';
import {
  allocateSellerObligation,
  SELLER_ALLOCATION_CONTRACT_V4,
} from '../../domain/money/allocation.js';
import { money } from '../../domain/money/money.js';

export interface EnsureSellerAllocationInput {
  readonly subjectKey: string;
  readonly orderCaptureAmountMinor: bigint;
  readonly inputEvidenceIds?: readonly string[];
  readonly inputEvidenceSetHash?: string;
}

export interface SellerAllocationExpectation {
  readonly subjectId: string;
  readonly expectationId: string;
  readonly expectationVersion: number;
  readonly sellerAllocationMinor: bigint;
  readonly platformAllocationMinor: bigint;
}

/**
 * Versioned seller-obligation expectation (backend PRD §7.2, §10.1). Uses the
 * exact demo allocation contract (₹5,00,000 -> ₹4,55,000 + ₹45,000).
 * Idempotent: calling this again for the same subject with the same rule
 * version returns the EXISTING current expectation rather than minting a new
 * version — "a changed rule creates a new expected-outcome version" (PRD
 * §9.3), and the rule has not changed here.
 */
export async function ensureSellerAllocationExpectation(
  db: Database,
  ctx: TenantContext,
  input: EnsureSellerAllocationInput,
): Promise<SellerAllocationExpectation> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}|seller-allocation|${input.subjectKey}`}, 0))`,
    );
    const existingSubject = await tx
      .select()
      .from(economicSubjects)
      .where(
        and(
          eq(economicSubjects.tenantId, ctx.tenantId),
          eq(economicSubjects.subjectType, 'seller_allocation'),
          eq(economicSubjects.subjectKey, input.subjectKey),
        ),
      )
      .limit(1);

    let subjectId = existingSubject[0]?.id;
    if (!subjectId) {
      subjectId = `subj_${randomUUID()}`;
      await tx.insert(economicSubjects).values({
        id: subjectId,
        tenantId: ctx.tenantId,
        subjectType: 'seller_allocation',
        subjectKey: input.subjectKey,
        amountMinor: input.orderCaptureAmountMinor,
        currency: 'INR',
      });
    } else if (existingSubject[0]?.amountMinor !== input.orderCaptureAmountMinor) {
      await tx
        .update(economicSubjects)
        .set({ amountMinor: input.orderCaptureAmountMinor })
        .where(
          and(eq(economicSubjects.tenantId, ctx.tenantId), eq(economicSubjects.id, subjectId)),
        );
    }

    const currentExpectation = await tx
      .select()
      .from(expectations)
      .where(
        and(
          eq(expectations.tenantId, ctx.tenantId),
          eq(expectations.subjectId, subjectId),
          eq(expectations.isCurrent, true),
        ),
      )
      .limit(1);

    const allocation = allocateSellerObligation(money(input.orderCaptureAmountMinor));
    const evidenceIds = [...new Set(input.inputEvidenceIds ?? [])].sort();
    const inputEvidenceSetHash =
      input.inputEvidenceSetHash ??
      contentHash({
        ruleId: SELLER_ALLOCATION_CONTRACT_V4.ruleId,
        ruleVersion: SELLER_ALLOCATION_CONTRACT_V4.ruleVersion,
        orderCaptureAmountMinor: input.orderCaptureAmountMinor.toString(),
        evidenceIds,
      });

    if (
      currentExpectation[0] &&
      currentExpectation[0].ruleVersion === SELLER_ALLOCATION_CONTRACT_V4.ruleVersion &&
      currentExpectation[0].expectedAmountMinor === allocation.sellerAllocation.amountMinor &&
      currentExpectation[0].inputEvidenceSetHash === inputEvidenceSetHash
    ) {
      return {
        subjectId,
        expectationId: currentExpectation[0].id,
        expectationVersion: currentExpectation[0].version,
        sellerAllocationMinor: BigInt(currentExpectation[0].expectedAmountMinor),
        platformAllocationMinor: allocation.platformAllocation.amountMinor,
      };
    }

    const nextVersion = (currentExpectation[0]?.version ?? 0) + 1;
    if (currentExpectation[0]) {
      await tx
        .update(expectations)
        .set({ isCurrent: false })
        .where(eq(expectations.id, currentExpectation[0].id));
    }

    const expectationId = `exp_${randomUUID()}`;
    await tx.insert(expectations).values({
      id: expectationId,
      tenantId: ctx.tenantId,
      subjectId,
      version: nextVersion,
      ruleId: SELLER_ALLOCATION_CONTRACT_V4.ruleId,
      ruleVersion: SELLER_ALLOCATION_CONTRACT_V4.ruleVersion,
      expectedAmountMinor: allocation.sellerAllocation.amountMinor,
      expectedTerminalState: 'bank_credit_verified',
      inputEvidenceSetHash,
      isCurrent: true,
    });
    if (evidenceIds.length > 0) {
      await tx.insert(expectationInputs).values(
        evidenceIds.map((evidenceId) => ({
          id: `exp_input_${randomUUID()}`,
          tenantId: ctx.tenantId,
          expectationId,
          evidenceId,
          inputRole: 'order_capture',
        })),
      );
    }

    return {
      subjectId,
      expectationId,
      expectationVersion: nextVersion,
      sellerAllocationMinor: allocation.sellerAllocation.amountMinor,
      platformAllocationMinor: allocation.platformAllocation.amountMinor,
    };
  });
}
