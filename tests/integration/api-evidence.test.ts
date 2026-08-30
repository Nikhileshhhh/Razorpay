import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import * as schema from '../../src/config/db-schema.js';
import { ingestEvents, outbox } from '../../src/config/db-schema.js';
import { loadEnv } from '../../src/config/env.js';
import { registerEvidenceRoutes } from '../../src/api/routes/evidence.js';
import { seedIdentity } from '../../src/modules/demo/seed-identity.js';
import { seedSourceConnections } from '../../src/modules/demo/seed-sources.js';
import { createMigratedTestDatabase, type TestDatabase } from './helpers/test-db.js';

const SOURCE_SECRET = 'TEST_ONLY_SYNTHETIC_HMAC_MARKER';
const WEBHOOK_SECRET = 'TEST_ONLY_WEBHOOK_HMAC_MARKER';

function signature(body: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function canonicalEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'evt_api_1',
    tenant_id: 'ten_demo',
    source_system: 'SYNTHETIC_RAZORPAY_FIXTURE',
    source_account_id: 'acct_demo_razorpay_fixture',
    source_event_id: 'source_api_1',
    source_event_type: 'payment.captured',
    event_type: 'PaymentCaptured',
    schema_version: '1.0',
    event_time: '2026-08-25T05:20:00Z',
    ingested_at: '2026-08-25T05:20:01Z',
    source_entity_version: 1,
    entity_references: { payment_id: 'pay_api_1', order_id: 'order_api_1' },
    economic_subject_hint: 'order:order_api_1:seller-1',
    amount_minor: '50000000',
    currency: 'INR',
    correlation_id: 'order_api_1',
    causation_id: null,
    payload_hash: `sha256:${'0'.repeat(64)}`,
    raw_payload_ref: 'db:pending',
    metadata: { environment: 'synthetic' },
    data: {},
    ...overrides,
  };
}

describe('evidence HTTP acceptance', () => {
  let testDb: TestDatabase;
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    pool = new pg.Pool({ connectionString: testDb.databaseUrl });
    db = drizzle(pool, { schema });
    await seedIdentity(db);
    await seedSourceConnections(db);
    app = Fastify({ logger: false });
    registerEvidenceRoutes(
      app,
      db,
      loadEnv({
        MONEYTRACE_ENV: 'test',
        NODE_ENV: 'test',
        DATABASE_URL: testDb.databaseUrl,
        SYNTHETIC_SOURCE_HMAC_SECRET: SOURCE_SECRET,
        RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
      }),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await testDb?.teardown();
  });

  it('atomically preserves exact bytes and creates only projection outbox work', async () => {
    const body = Buffer.from(JSON.stringify(canonicalEvent()), 'utf8');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: {
        'content-type': 'application/json',
        'x-moneytrace-source-system': 'SYNTHETIC_RAZORPAY_FIXTURE',
        'x-moneytrace-source-account': 'acct_demo_razorpay_fixture',
        'x-moneytrace-signature': signature(body, SOURCE_SECRET),
      },
      payload: body,
    });
    expect(response.statusCode).toBe(202);
    const rows = await db
      .select()
      .from(ingestEvents)
      .where(eq(ingestEvents.sourceEventId, 'source_api_1'));
    expect(rows).toHaveLength(1);
    expect(Buffer.compare(rows[0]!.rawBytes, body)).toBe(0);
    expect(rows[0]?.rawRepresentation).toBe('exact_bytes');
    const work = await db
      .select()
      .from(outbox)
      .where(and(eq(outbox.tenantId, 'ten_demo'), eq(outbox.domainEventId, rows[0]!.id)));
    expect(work.map((row) => row.topic)).toEqual(['project-evidence.v1']);
  });

  it('rejects a tenant asserted by the body when it differs from connector identity', async () => {
    const body = JSON.stringify(
      canonicalEvent({
        event_id: 'evt_tenant_mismatch',
        source_event_id: 'source_tenant_mismatch',
        tenant_id: 'ten_other',
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: {
        'content-type': 'application/json',
        'x-moneytrace-source-system': 'SYNTHETIC_RAZORPAY_FIXTURE',
        'x-moneytrace-source-account': 'acct_demo_razorpay_fixture',
        'x-moneytrace-signature': signature(body, SOURCE_SECRET),
      },
      payload: body,
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects an invalid webhook HMAC before retaining any evidence', async () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/razorpay',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': 'TEST_ONLY_INVALID_SIGNATURE',
        'x-razorpay-account-id': 'acct_demo_razorpay_test',
        'x-razorpay-event-id': 'razorpay_invalid_hmac',
      },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
    const retained = await db
      .select({ id: ingestEvents.id })
      .from(ingestEvents)
      .where(eq(ingestEvents.sourceEventId, 'razorpay_invalid_hmac'));
    expect(retained).toHaveLength(0);
  });

  it('quarantines authenticated but unmappable webhook bytes without projection work', async () => {
    const body = Buffer.from(
      JSON.stringify({
        event: 'payment.unsupported',
        payload: { payment: { entity: { id: 'pay_unknown' } } },
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/razorpay',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signature(body, WEBHOOK_SECRET),
        'x-razorpay-account-id': 'acct_demo_razorpay_test',
        'x-razorpay-event-id': 'razorpay_unmapped_1',
      },
      payload: body,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().data.status).toBe('quarantined');
    const retained = await db
      .select()
      .from(ingestEvents)
      .where(eq(ingestEvents.sourceEventId, 'razorpay_unmapped_1'));
    expect(retained).toHaveLength(1);
    expect(retained[0]?.quarantineStatus).toBe('quarantined');
    expect(retained[0]?.eventType).toBeNull();
    expect(Buffer.compare(retained[0]!.rawBytes, body)).toBe(0);
    const work = await db
      .select({ id: outbox.id })
      .from(outbox)
      .where(eq(outbox.domainEventId, retained[0]!.id));
    expect(work).toHaveLength(0);
  });

  it('returns the safe standard envelope for oversized evidence', async () => {
    const body = 'x'.repeat(1_048_577);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      schema_version: '1.0',
      error: { code: 'SCHEMA_INVALID', retryable: false, details: { kind: 'none' } },
    });
  });

  it('rejects a missing direct-event signature header (distinct from an invalid one) with a safe envelope', async () => {
    const body = Buffer.from(JSON.stringify(canonicalEvent({ event_id: 'evt_no_sig' })), 'utf8');
    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: {
        'content-type': 'application/json',
        'x-moneytrace-source-system': 'SYNTHETIC_RAZORPAY_FIXTURE',
        'x-moneytrace-source-account': 'acct_demo_razorpay_fixture',
      },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      schema_version: '1.0',
      error: { code: 'POLICY_DENIED', retryable: false, details: { kind: 'none' } },
    });
  });

  it('rejects an invalid (present but wrong) direct-event signature before retaining any evidence', async () => {
    const body = Buffer.from(
      JSON.stringify(
        canonicalEvent({ event_id: 'evt_wrong_sig', source_event_id: 'source_wrong_sig' }),
      ),
      'utf8',
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: {
        'content-type': 'application/json',
        'x-moneytrace-source-system': 'SYNTHETIC_RAZORPAY_FIXTURE',
        'x-moneytrace-source-account': 'acct_demo_razorpay_fixture',
        'x-moneytrace-signature': signature(body, 'TEST_ONLY_WRONG_SECRET'),
      },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
    const retained = await db
      .select({ id: ingestEvents.id })
      .from(ingestEvents)
      .where(eq(ingestEvents.sourceEventId, 'source_wrong_sig'));
    expect(retained).toHaveLength(0);
  });

  it('rejects an unknown source account for a direct event with a properly signed body', async () => {
    const body = Buffer.from(
      JSON.stringify(
        canonicalEvent({
          event_id: 'evt_unknown_account',
          source_event_id: 'source_unknown_account',
          source_account_id: 'acct_does_not_exist',
        }),
      ),
      'utf8',
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: {
        'content-type': 'application/json',
        'x-moneytrace-source-system': 'SYNTHETIC_RAZORPAY_FIXTURE',
        'x-moneytrace-source-account': 'acct_does_not_exist',
        'x-moneytrace-signature': signature(body, SOURCE_SECRET),
      },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a body that claims a different source_account_id than the authenticated header', async () => {
    const body = Buffer.from(
      JSON.stringify(
        canonicalEvent({
          event_id: 'evt_source_mismatch',
          source_event_id: 'source_body_mismatch',
          // The header authenticates as acct_demo_razorpay_fixture (a REAL,
          // resolvable account), but the body claims a DIFFERENT account —
          // this must be rejected even though the header's own auth is valid.
          source_account_id: 'acct_demo_oms',
        }),
      ),
      'utf8',
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: {
        'content-type': 'application/json',
        'x-moneytrace-source-system': 'SYNTHETIC_RAZORPAY_FIXTURE',
        'x-moneytrace-source-account': 'acct_demo_razorpay_fixture',
        'x-moneytrace-signature': signature(body, SOURCE_SECRET),
      },
      payload: body,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('SCHEMA_INVALID');
    const retained = await db
      .select({ id: ingestEvents.id })
      .from(ingestEvents)
      .where(eq(ingestEvents.sourceEventId, 'source_body_mismatch'));
    expect(retained).toHaveLength(0);
  });

  it('rejects a body that claims a different source_system than the authenticated header', async () => {
    const body = Buffer.from(
      JSON.stringify(
        canonicalEvent({
          event_id: 'evt_system_mismatch',
          source_event_id: 'source_system_mismatch',
          source_system: 'SYNTHETIC_OMS',
        }),
      ),
      'utf8',
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: {
        'content-type': 'application/json',
        'x-moneytrace-source-system': 'SYNTHETIC_RAZORPAY_FIXTURE',
        'x-moneytrace-source-account': 'acct_demo_razorpay_fixture',
        'x-moneytrace-signature': signature(body, SOURCE_SECRET),
      },
      payload: body,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('SCHEMA_INVALID');
  });

  it('rejects an unknown Razorpay account id for a properly signed webhook', async () => {
    const body = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/razorpay',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signature(body, WEBHOOK_SECRET),
        'x-razorpay-account-id': 'acct_does_not_exist',
        'x-razorpay-event-id': 'razorpay_unknown_account',
      },
      payload: body,
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns a safe 400 for malformed JSON on both the direct-event and webhook routes', async () => {
    const malformed = Buffer.from('{ this is not valid json', 'utf8');

    const direct = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: {
        'content-type': 'application/json',
        'x-moneytrace-source-system': 'SYNTHETIC_RAZORPAY_FIXTURE',
        'x-moneytrace-source-account': 'acct_demo_razorpay_fixture',
        'x-moneytrace-signature': signature(malformed, SOURCE_SECRET),
      },
      payload: malformed,
    });
    expect(direct.statusCode).toBe(400);
    expect(direct.json()).toMatchObject({
      schema_version: '1.0',
      error: { code: 'SCHEMA_INVALID', retryable: false, details: { kind: 'none' } },
    });

    // A malformed webhook body cannot resolve an account id from JSON at all,
    // so it is treated as authenticated-but-unmappable and quarantined
    // rather than crashing the request.
    const webhook = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/razorpay',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signature(malformed, WEBHOOK_SECRET),
        'x-razorpay-account-id': 'acct_demo_razorpay_test',
        'x-razorpay-event-id': 'razorpay_malformed_json',
      },
      payload: malformed,
    });
    expect(webhook.statusCode).toBe(202);
    expect(webhook.json().data.status).toBe('quarantined');
  });

  it('treats an exact-duplicate direct event as an idempotent accept, not an error', async () => {
    const body = Buffer.from(
      JSON.stringify(
        canonicalEvent({ event_id: 'evt_exact_dup', source_event_id: 'source_exact_dup' }),
      ),
      'utf8',
    );
    const headers = {
      'content-type': 'application/json',
      'x-moneytrace-source-system': 'SYNTHETIC_RAZORPAY_FIXTURE',
      'x-moneytrace-source-account': 'acct_demo_razorpay_fixture',
      'x-moneytrace-signature': signature(body, SOURCE_SECRET),
    };
    const first = await app.inject({ method: 'POST', url: '/v1/events', headers, payload: body });
    expect(first.statusCode).toBe(202);
    expect(first.json().data.status).toBe('accepted');
    const second = await app.inject({ method: 'POST', url: '/v1/events', headers, payload: body });
    expect(second.statusCode).toBe(202);
    expect(second.json().data.status).toBe('duplicate');
    const rows = await db
      .select()
      .from(ingestEvents)
      .where(eq(ingestEvents.sourceEventId, 'source_exact_dup'));
    expect(rows).toHaveLength(1);
  });

  it('returns 409 EVIDENCE_CONFLICT for the same source_event_id with different bytes', async () => {
    const first = Buffer.from(
      JSON.stringify(
        canonicalEvent({ event_id: 'evt_conflict_a', source_event_id: 'source_conflict' }),
      ),
      'utf8',
    );
    const conflicting = Buffer.from(
      JSON.stringify(
        canonicalEvent({
          event_id: 'evt_conflict_b',
          source_event_id: 'source_conflict',
          amount_minor: '1',
        }),
      ),
      'utf8',
    );
    const headersFor = (buf: Buffer) => ({
      'content-type': 'application/json',
      'x-moneytrace-source-system': 'SYNTHETIC_RAZORPAY_FIXTURE',
      'x-moneytrace-source-account': 'acct_demo_razorpay_fixture',
      'x-moneytrace-signature': signature(buf, SOURCE_SECRET),
    });
    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: headersFor(first),
      payload: first,
    });
    expect(accepted.statusCode).toBe(202);
    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: headersFor(conflicting),
      payload: conflicting,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      schema_version: '1.0',
      error: { code: 'EVIDENCE_CONFLICT', retryable: false },
    });
  });

  it('returns 409 EVIDENCE_CONFLICT for an exact-duplicate Razorpay event id with conflicting bytes', async () => {
    const first = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_webhook_conflict',
              amount: 50_000_000,
              currency: 'INR',
              created_at: 1_756_098_000,
            },
          },
        },
      }),
    );
    const conflicting = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_webhook_conflict',
              amount: 1,
              currency: 'INR',
              created_at: 1_756_098_000,
            },
          },
        },
      }),
    );
    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/razorpay',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signature(first, WEBHOOK_SECRET),
        'x-razorpay-account-id': 'acct_demo_razorpay_test',
        'x-razorpay-event-id': 'razorpay_webhook_conflict',
      },
      payload: first,
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().data.status).toBe('accepted');
    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/razorpay',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signature(conflicting, WEBHOOK_SECRET),
        'x-razorpay-account-id': 'acct_demo_razorpay_test',
        'x-razorpay-event-id': 'razorpay_webhook_conflict',
      },
      payload: conflicting,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('EVIDENCE_CONFLICT');
  });

  it('maps a supported Razorpay payment.captured webhook to a canonical PaymentCaptured event', async () => {
    const body = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_supported_captured',
              amount: 50_000_000,
              currency: 'INR',
              created_at: 1_756_098_000,
              order_id: 'order_supported_captured',
            },
          },
        },
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/razorpay',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signature(body, WEBHOOK_SECRET),
        'x-razorpay-account-id': 'acct_demo_razorpay_test',
        'x-razorpay-event-id': 'razorpay_supported_captured',
      },
      payload: body,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().data.status).toBe('accepted');
    const rows = await db
      .select()
      .from(ingestEvents)
      .where(eq(ingestEvents.sourceEventId, 'razorpay_supported_captured'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventType).toBe('PaymentCaptured');
    expect(rows[0]?.amountMinor).toBe(50_000_000n);
    expect(rows[0]?.economicSubjectHint).toBe('order:order_supported_captured');
  });

  it('maps a supported Razorpay transfer.processed webhook to a canonical TransferProcessed event', async () => {
    const body = Buffer.from(
      JSON.stringify({
        event: 'transfer.processed',
        payload: {
          transfer: {
            entity: {
              id: 'transfer_supported',
              amount: 45_500_000,
              currency: 'INR',
              created_at: 1_756_098_600,
              order_id: 'order_supported_transfer',
              recipient: 'recipient_supported',
            },
          },
        },
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/razorpay',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signature(body, WEBHOOK_SECRET),
        'x-razorpay-account-id': 'acct_demo_razorpay_test',
        'x-razorpay-event-id': 'razorpay_supported_transfer',
      },
      payload: body,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().data.status).toBe('accepted');
    const rows = await db
      .select()
      .from(ingestEvents)
      .where(eq(ingestEvents.sourceEventId, 'razorpay_supported_transfer'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventType).toBe('TransferProcessed');
    expect(rows[0]?.amountMinor).toBe(45_500_000n);
  });
});
