import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../../../src/config/db-schema.js';
import { createMigratedTestDatabase, type TestDatabase } from '../helpers/test-db.js';
import { resetDemoDatabase } from '../../../src/modules/demo/reset.js';
import type { Database } from '../../../src/config/db.js';
import { createTenantContext } from '../../../src/modules/identity/tenant-context.js';
import { EnvSchema, resolveSyntheticHmacSecret, type Env } from '../../../src/config/env.js';
import { authenticateConnector } from '../../../src/modules/identity/connector-principal.js';
import {
  acceptAgentClaim,
  evaluateAgentClaim,
  ClaimIdempotencyConflictError,
  ClaimEvidenceInvalidError,
  ClaimAttributionConflictError,
} from '../../../src/modules/claims/claim-service.js';
import type { AgentResultClaim } from '../../../src/contracts/agent-claims.js';
import { canonicalJsonStringify } from '../../../src/config/hashing.js';
import {
  CanonicalEvent,
  type CanonicalEvent as CanonicalEventValue,
} from '../../../src/contracts/events/canonical-event.js';
import type {
  CanonicalEventType,
  SourceSystem,
} from '../../../src/contracts/events/event-types.js';
import { contentHash } from '../../../src/config/hashing.js';
import { ingestAndProject } from '../../../src/modules/ingestion/pipeline.js';

const TENANT_ID = 'ten_demo';
const CLOCK = new Date('2026-08-25T05:20:00.000Z');
const AGENT_ACCOUNT = 'acct_demo_agent';

const SOURCE_ACCOUNTS: Readonly<Record<string, string>> = {
  SYNTHETIC_RAZORPAY_FIXTURE: 'acct_demo_razorpay_fixture',
};

interface EvidenceInput {
  readonly key: string;
  readonly subject: string;
  readonly type: CanonicalEventType;
  readonly source: SourceSystem;
  readonly occurredAt: string;
  readonly amountMinor?: bigint;
  readonly references: Record<string, string>;
}

function buildEvent(input: EvidenceInput): CanonicalEventValue {
  return CanonicalEvent.parse({
    schema_version: '1.0',
    event_id: `claimtest_${input.key}`,
    tenant_id: TENANT_ID,
    source_system: input.source,
    source_account_id: SOURCE_ACCOUNTS[input.source] ?? `acct_${input.source}`,
    source_event_id: `claimtest_${input.key}`,
    source_event_type: input.type,
    event_type: input.type,
    event_time: input.occurredAt,
    ingested_at: CLOCK.toISOString(),
    source_entity_version: 1,
    entity_references: input.references,
    economic_subject_hint: input.subject,
    amount_minor: input.amountMinor?.toString() ?? null,
    currency: input.amountMinor === undefined ? null : 'INR',
    correlation_id: `claimtest_${input.subject.replaceAll(':', '_')}`,
    causation_id: null,
    payload_hash: contentHash({ claimtest_event: input.key }),
    raw_payload_ref: `db:claimtest/${input.key}`,
    metadata: { environment: 'synthetic' },
    data: {},
  });
}

async function ingestEvidence(db: Database, input: EvidenceInput): Promise<string> {
  const ctx = createTenantContext(TENANT_ID, 'demo');
  const event = buildEvent(input);
  const outcome = await ingestAndProject(db, ctx, {
    event,
    rawBytes: canonicalJsonStringify(event),
    rawRepresentation: 'canonical_row',
    signatureStatus: 'verified',
    sourceIdentity: `${input.source}:${SOURCE_ACCOUNTS[input.source] ?? input.source}`,
  });
  if (outcome.outcome === 'conflict') throw new Error('claim test evidence conflicted');
  return outcome.eventId;
}

async function signClaim(db: Database, env: Env, claim: AgentResultClaim) {
  const raw = Buffer.from(canonicalJsonStringify(claim), 'utf8');
  const secret = resolveSyntheticHmacSecret(env);
  return authenticateConnector(db, {
    sourceSystem: 'SYNTHETIC_AGENT',
    externalAccountId: AGENT_ACCOUNT,
    rawBytes: raw,
    providedSignature: createHmac('sha256', secret).update(raw).digest('hex'),
    secret,
  });
}

describe('Gate B4 agent claim adversarial coverage', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let env: Env;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    pool = new pg.Pool({ connectionString: testDb.databaseUrl });
    db = drizzle(pool, { schema });
    await resetDemoDatabase(pool, db, 'demo');
    env = EnvSchema.parse({ MONEYTRACE_ENV: 'test', NODE_ENV: 'test' });
  }, 180_000);

  const sign = (claim: AgentResultClaim) => signClaim(db, env, claim);

  afterAll(async () => {
    await pool?.end();
    await testDb?.teardown();
  });

  function baseClaim(overrides: Partial<AgentResultClaim>): AgentResultClaim {
    return {
      schema_version: '1.0',
      external_claim_id: 'default_claim',
      external_agent_id: 'demo_agent',
      tenant_id: TENANT_ID,
      economic_subject: 'claim:default',
      claimed_amount: { amount_minor: '1000000', currency: 'INR' },
      result_type: 'RECOVERY',
      attribution_method: 'CORRELATED',
      correlation_id: 'default',
      claim_time: '2026-08-25T01:10:00.000Z',
      evidence_time: '2026-08-25T01:00:00.000Z',
      evidence_refs: [],
      ...overrides,
    };
  }

  it('rejects a claim whose evidence_refs point at evidence for a DIFFERENT subject', async () => {
    const subject = 'claim:unrelated-evidence';
    const otherSubject = 'claim:unrelated-evidence-other';
    const unrelatedEvidenceId = await ingestEvidence(db, {
      key: 'unrelated_capture',
      subject: otherSubject,
      type: 'PaymentCaptured',
      source: 'SYNTHETIC_RAZORPAY_FIXTURE',
      occurredAt: '2026-08-25T01:00:00.000Z',
      amountMinor: 1_000_000n,
      references: { payment_id: 'unrelated_payment' },
    });
    const claim = baseClaim({
      external_claim_id: 'unrelated_evidence_claim',
      economic_subject: subject,
      evidence_refs: [{ evidence_id: unrelatedEvidenceId, evidence_type: 'captured_payment' }],
    });
    const principal = await sign(claim);
    await expect(acceptAgentClaim(db, principal, claim, CLOCK)).rejects.toBeInstanceOf(
      ClaimEvidenceInvalidError,
    );
  });

  it('rejects a claim referencing evidence that does not exist', async () => {
    const claim = baseClaim({
      external_claim_id: 'nonexistent_evidence_claim',
      economic_subject: 'claim:nonexistent-evidence',
      evidence_refs: [{ evidence_id: 'evt_does_not_exist', evidence_type: 'captured_payment' }],
    });
    const principal = await sign(claim);
    await expect(acceptAgentClaim(db, principal, claim, CLOCK)).rejects.toBeInstanceOf(
      ClaimEvidenceInvalidError,
    );
  });

  it('rejects a declared evidence type that does not match the canonical event', async () => {
    const subject = 'claim:mismatched-type';
    const evidenceId = await ingestEvidence(db, {
      key: 'mismatched_type_order',
      subject,
      type: 'OrderPaid',
      source: 'SYNTHETIC_RAZORPAY_FIXTURE',
      occurredAt: '2026-08-25T01:00:00.000Z',
      amountMinor: 1_000_000n,
      references: { order_id: 'mismatched_type_order' },
    });
    const claim = baseClaim({
      external_claim_id: 'mismatched_type_claim',
      economic_subject: subject,
      evidence_refs: [{ evidence_id: evidenceId, evidence_type: 'captured_payment' }],
    });
    await expect(acceptAgentClaim(db, await sign(claim), claim, CLOCK)).rejects.toBeInstanceOf(
      ClaimEvidenceInvalidError,
    );
  });

  it('credits only bound capture evidence, not another capture sharing the subject', async () => {
    const subject = 'claim:correlation-boundary';
    const boundId = await ingestEvidence(db, {
      key: 'correlation_bound_capture',
      subject,
      type: 'PaymentCaptured',
      source: 'SYNTHETIC_RAZORPAY_FIXTURE',
      occurredAt: '2026-08-25T01:00:00.000Z',
      amountMinor: 2_000_000n,
      references: { payment_id: 'correlation_bound_payment' },
    });
    await ingestEvidence(db, {
      key: 'correlation_unbound_capture',
      subject,
      type: 'PaymentCaptured',
      source: 'SYNTHETIC_RAZORPAY_FIXTURE',
      occurredAt: '2026-08-25T01:01:00.000Z',
      amountMinor: 3_000_000n,
      references: { payment_id: 'correlation_unbound_payment' },
    });
    const claim = baseClaim({
      external_claim_id: 'correlation_bound_claim',
      economic_subject: subject,
      claimed_amount: { amount_minor: '5000000', currency: 'INR' },
      evidence_refs: [{ evidence_id: boundId, evidence_type: 'captured_payment' }],
    });
    const accepted = await acceptAgentClaim(db, await sign(claim), claim, CLOCK);
    const evaluation = await evaluateAgentClaim(
      db,
      createTenantContext(TENANT_ID, 'demo'),
      accepted.claimId,
      CLOCK,
    );
    expect(evaluation.status).toBe('PARTIALLY_VERIFIED');
    expect(evaluation.verified_amount?.amount_minor).toBe('2000000');
  });

  it('prevents concurrent claims from attributing the same captured payment twice', async () => {
    const subject = 'claim:capture-allocation';
    const evidenceId = await ingestEvidence(db, {
      key: 'capture_allocation_capture',
      subject,
      type: 'PaymentCaptured',
      source: 'SYNTHETIC_RAZORPAY_FIXTURE',
      occurredAt: '2026-08-25T01:00:00.000Z',
      amountMinor: 2_000_000n,
      references: { payment_id: 'capture_allocation_payment' },
    });
    const claims = ['capture_allocation_a', 'capture_allocation_b'].map((externalClaimId) =>
      baseClaim({
        external_claim_id: externalClaimId,
        economic_subject: subject,
        claimed_amount: { amount_minor: '2000000', currency: 'INR' },
        evidence_refs: [{ evidence_id: evidenceId, evidence_type: 'captured_payment' }],
      }),
    );
    const results = await Promise.allSettled(
      claims.map(async (claim) => acceptAgentClaim(db, await sign(claim), claim, CLOCK)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toBeDefined();
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(ClaimAttributionConflictError);
    }
  });

  it('same idempotency key with the SAME body replays; with a DIFFERENT body conflicts (409-mapped)', async () => {
    const subject = 'claim:idempotency';
    const evidenceId = await ingestEvidence(db, {
      key: 'idempotency_capture',
      subject,
      type: 'PaymentCaptured',
      source: 'SYNTHETIC_RAZORPAY_FIXTURE',
      occurredAt: '2026-08-25T01:00:00.000Z',
      amountMinor: 2_000_000n,
      references: { payment_id: 'idempotency_payment' },
    });
    const claim = baseClaim({
      external_claim_id: 'idempotency_claim',
      economic_subject: subject,
      claimed_amount: { amount_minor: '2000000', currency: 'INR' },
      evidence_refs: [{ evidence_id: evidenceId, evidence_type: 'captured_payment' }],
    });
    const principal = await sign(claim);
    const first = await acceptAgentClaim(db, principal, claim, CLOCK);
    expect(first.idempotentReplay).toBe(false);

    // Exact same body, same external_claim_id/external_agent_id -> replay,
    // never a duplicate claim row.
    const replayPrincipal = await sign(claim);
    const replay = await acceptAgentClaim(db, replayPrincipal, claim, CLOCK);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.claimId).toBe(first.claimId);

    // Same key, DIFFERENT body (different claimed amount) -> a real conflict,
    // never silently accepted as a second claim under the same key.
    const conflicting = baseClaim({
      external_claim_id: 'idempotency_claim',
      economic_subject: subject,
      claimed_amount: { amount_minor: '999999', currency: 'INR' },
      evidence_refs: [{ evidence_id: evidenceId, evidence_type: 'captured_payment' }],
    });
    const conflictingPrincipal = await sign(conflicting);
    await expect(
      acceptAgentClaim(db, conflictingPrincipal, conflicting, CLOCK),
    ).rejects.toBeInstanceOf(ClaimIdempotencyConflictError);

    const rows = await db
      .select()
      .from(schema.agentResultClaims)
      .where(
        and(
          eq(schema.agentResultClaims.tenantId, TENANT_ID),
          eq(schema.agentResultClaims.externalClaimId, 'idempotency_claim'),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it('full attribution: captures exactly matching the claim verify VERIFIED for the full amount', async () => {
    const subject = 'claim:full';
    const evidenceId = await ingestEvidence(db, {
      key: 'full_capture',
      subject,
      type: 'PaymentCaptured',
      source: 'SYNTHETIC_RAZORPAY_FIXTURE',
      occurredAt: '2026-08-25T01:00:00.000Z',
      amountMinor: 5_000_000n,
      references: { payment_id: 'full_payment' },
    });
    const claim = baseClaim({
      external_claim_id: 'full_claim',
      economic_subject: subject,
      claimed_amount: { amount_minor: '5000000', currency: 'INR' },
      evidence_refs: [{ evidence_id: evidenceId, evidence_type: 'captured_payment' }],
    });
    const principal = await sign(claim);
    const accepted = await acceptAgentClaim(db, principal, claim, CLOCK);
    const evaluation = await evaluateAgentClaim(
      db,
      createTenantContext(TENANT_ID, 'demo'),
      accepted.claimId,
      CLOCK,
    );
    expect(evaluation.status).toBe('VERIFIED');
    expect(evaluation.verified_amount?.amount_minor).toBe('5000000');
  });

  it('partial attribution: a claim larger than the eligible captures verifies PARTIALLY_VERIFIED', async () => {
    const subject = 'claim:partial';
    const evidenceId = await ingestEvidence(db, {
      key: 'partial_capture',
      subject,
      type: 'PaymentCaptured',
      source: 'SYNTHETIC_RAZORPAY_FIXTURE',
      occurredAt: '2026-08-25T01:00:00.000Z',
      amountMinor: 3_000_000n,
      references: { payment_id: 'partial_payment' },
    });
    const claim = baseClaim({
      external_claim_id: 'partial_claim',
      economic_subject: subject,
      claimed_amount: { amount_minor: '6000000', currency: 'INR' },
      evidence_refs: [{ evidence_id: evidenceId, evidence_type: 'captured_payment' }],
    });
    const principal = await sign(claim);
    const accepted = await acceptAgentClaim(db, principal, claim, CLOCK);
    const evaluation = await evaluateAgentClaim(
      db,
      createTenantContext(TENANT_ID, 'demo'),
      accepted.claimId,
      CLOCK,
    );
    expect(evaluation.status).toBe('PARTIALLY_VERIFIED');
    expect(evaluation.verified_amount?.amount_minor).toBe('3000000');
  });

  it('unresolved attribution: a capture already offset by a linked refund remains UNRESOLVED', async () => {
    const subject = 'claim:unresolved';
    const evidenceId = await ingestEvidence(db, {
      key: 'unresolved_capture',
      subject,
      type: 'PaymentCaptured',
      source: 'SYNTHETIC_RAZORPAY_FIXTURE',
      occurredAt: '2026-08-25T01:00:00.000Z',
      amountMinor: 1_000_000n,
      references: { payment_id: 'unresolved_payment' },
    });
    await ingestEvidence(db, {
      key: 'unresolved_refund',
      subject,
      type: 'RefundProcessed',
      source: 'SYNTHETIC_RAZORPAY_FIXTURE',
      occurredAt: '2026-08-25T01:05:00.000Z',
      amountMinor: 1_000_000n,
      references: { refund_id: 'unresolved_refund', payment_id: 'unresolved_payment' },
    });
    const claim = baseClaim({
      external_claim_id: 'unresolved_claim',
      economic_subject: subject,
      claimed_amount: { amount_minor: '4000000', currency: 'INR' },
      evidence_refs: [{ evidence_id: evidenceId, evidence_type: 'captured_payment' }],
    });
    const principal = await sign(claim);
    const accepted = await acceptAgentClaim(db, principal, claim, CLOCK);
    const evaluation = await evaluateAgentClaim(
      db,
      createTenantContext(TENANT_ID, 'demo'),
      accepted.claimId,
      CLOCK,
    );
    expect(evaluation.status).toBe('UNRESOLVED');
    expect(evaluation.verified_amount).toBeNull();
  });

  it('counts RefundCreated and RefundProcessed for one refund id exactly once', async () => {
    const subject = 'claim:refund-lifecycle';
    const evidenceId = await ingestEvidence(db, {
      key: 'refund_lifecycle_capture',
      subject,
      type: 'PaymentCaptured',
      source: 'SYNTHETIC_RAZORPAY_FIXTURE',
      occurredAt: '2026-08-25T01:00:00.000Z',
      amountMinor: 7_000_000n,
      references: { payment_id: 'refund_lifecycle_payment' },
    });
    const claim = baseClaim({
      external_claim_id: 'refund_lifecycle_claim',
      economic_subject: subject,
      claimed_amount: { amount_minor: '7000000', currency: 'INR' },
      evidence_refs: [{ evidence_id: evidenceId, evidence_type: 'captured_payment' }],
    });
    const accepted = await acceptAgentClaim(db, await sign(claim), claim, CLOCK);
    const ctx = createTenantContext(TENANT_ID, 'demo');
    expect((await evaluateAgentClaim(db, ctx, accepted.claimId, CLOCK)).status).toBe('VERIFIED');
    for (const type of ['RefundCreated', 'RefundProcessed'] as const) {
      await ingestEvidence(db, {
        key: `refund_lifecycle_${type}`,
        subject,
        type,
        source: 'SYNTHETIC_RAZORPAY_FIXTURE',
        occurredAt: '2026-08-25T02:00:00.000Z',
        amountMinor: 7_000_000n,
        references: {
          refund_id: 'refund_lifecycle_refund',
          payment_id: 'refund_lifecycle_payment',
        },
      });
    }
    const reversed = await evaluateAgentClaim(db, ctx, accepted.claimId, CLOCK);
    expect(reversed.status).toBe('REVERSED');
    expect(reversed.verified_amount?.amount_minor).toBe('0');
  });

  it('reversed attribution: a full refund after VERIFIED reverses the claim to ₹0, never silently staying VERIFIED', async () => {
    const subject = 'claim:reversed';
    const evidenceId = await ingestEvidence(db, {
      key: 'reversed_capture',
      subject,
      type: 'PaymentCaptured',
      source: 'SYNTHETIC_RAZORPAY_FIXTURE',
      occurredAt: '2026-08-25T01:00:00.000Z',
      amountMinor: 7_000_000n,
      references: { payment_id: 'reversed_payment' },
    });
    const claim = baseClaim({
      external_claim_id: 'reversed_claim',
      economic_subject: subject,
      claimed_amount: { amount_minor: '7000000', currency: 'INR' },
      evidence_refs: [{ evidence_id: evidenceId, evidence_type: 'captured_payment' }],
    });
    const principal = await sign(claim);
    const accepted = await acceptAgentClaim(db, principal, claim, CLOCK);
    const ctx = createTenantContext(TENANT_ID, 'demo');
    const firstEval = await evaluateAgentClaim(db, ctx, accepted.claimId, CLOCK);
    expect(firstEval.status).toBe('VERIFIED');

    await ingestEvidence(db, {
      key: 'reversed_refund',
      subject,
      type: 'RefundProcessed',
      source: 'SYNTHETIC_RAZORPAY_FIXTURE',
      occurredAt: '2026-08-25T02:00:00.000Z',
      amountMinor: 7_000_000n,
      references: { refund_id: 'reversed_refund', payment_id: 'reversed_payment' },
    });
    const secondEval = await evaluateAgentClaim(db, ctx, accepted.claimId, CLOCK);
    expect(secondEval.status).toBe('REVERSED');
    expect(secondEval.verified_amount?.amount_minor).toBe('0');
  });
});
