import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../../config/db.js';
import type { Env } from '../../config/env.js';
import { rawBytesHash } from '../../config/hashing.js';
import { toSafeError } from '../../config/errors.js';
import {
  SubmitEventRequest,
  EventAcceptedResponse,
  WebhookAcceptedResponse,
} from '../../contracts/api-endpoints.js';
import { SourceSystem, type CanonicalEventType } from '../../contracts/events/event-types.js';
import {
  acceptEvidence,
  EvidenceTenantMismatchError,
  quarantineAuthenticatedEvidence,
} from '../../modules/ingestion/ingestion-service.js';
import { resolveSourceTenant, verifyHmacSha256 } from '../../modules/ingestion/source-auth.js';

const MAX_EVIDENCE_BYTES = 1_048_576;

export function registerEvidenceRoutes(app: FastifyInstance, db: Database, env: Env): void {
  void app.register(async (scope) => {
    scope.setErrorHandler((caught, req, reply) => {
      const statusCode =
        caught && typeof caught === 'object' && 'statusCode' in caught
          ? (caught as { statusCode?: unknown }).statusCode
          : undefined;
      if (statusCode === 413) {
        return reply
          .code(413)
          .send(error(req, 'SCHEMA_INVALID', 'evidence payload exceeds the allowed size'));
      }
      req.log.error({ err: toSafeError(caught, 'database') }, 'evidence request failed');
      return reply
        .code(503)
        .send(error(req, 'SOURCE_UNAVAILABLE', 'evidence service is temporarily unavailable'));
    });
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: MAX_EVIDENCE_BYTES },
      (_request, body, done) => done(null, body),
    );

    scope.post('/v1/events', async (req, reply) => {
      const raw = asBuffer(req.body);
      const secret = env.SYNTHETIC_SOURCE_HMAC_SECRET;
      if (!secret)
        return reply
          .code(503)
          .send(error(req, 'SOURCE_UNAVAILABLE', 'source authentication is not configured'));
      const sourceHeader = header(req, 'x-moneytrace-source-system');
      const source = SourceSystem.safeParse(sourceHeader);
      const accountId = header(req, 'x-moneytrace-source-account');
      if (!source.success || !accountId)
        return reply.code(401).send(error(req, 'POLICY_DENIED', 'source authentication failed'));
      if (!verifyHmacSha256(raw, header(req, 'x-moneytrace-signature'), secret)) {
        return reply.code(401).send(error(req, 'POLICY_DENIED', 'source authentication failed'));
      }
      const ctx = await resolveSourceTenant(db, source.data, accountId);
      if (!ctx)
        return reply.code(401).send(error(req, 'POLICY_DENIED', 'source authentication failed'));

      const parsedJson = parseJson(raw);
      const parsed = SubmitEventRequest.safeParse(parsedJson);
      if (
        !parsed.success ||
        parsed.data.source_system !== source.data ||
        parsed.data.source_account_id !== accountId
      ) {
        return reply.code(400).send(error(req, 'SCHEMA_INVALID', 'canonical event is invalid'));
      }
      try {
        const outcome = await acceptEvidence(db, ctx, {
          event: parsed.data,
          rawBytes: raw,
          rawRepresentation: 'exact_bytes',
          signatureStatus: 'verified',
          sourceIdentity: `${source.data}:${accountId}`,
        });
        if (outcome.outcome === 'conflict') {
          return reply
            .code(409)
            .send(
              error(req, 'EVIDENCE_CONFLICT', 'source event id conflicts with accepted evidence'),
            );
        }
        return reply.code(202).send(
          EventAcceptedResponse.parse({
            schema_version: '1.0',
            request_id: req.id,
            resource_version: 0,
            data: { event_id: outcome.eventId, status: outcome.outcome },
          }),
        );
      } catch (caught) {
        if (caught instanceof EvidenceTenantMismatchError) {
          return reply
            .code(403)
            .send(
              error(
                req,
                'TENANT_SCOPE_REQUIRED',
                'event tenant does not match authenticated source',
              ),
            );
        }
        throw caught;
      }
    });

    scope.post('/v1/webhooks/razorpay', async (req, reply) => {
      const raw = asBuffer(req.body);
      const secret = env.RAZORPAY_WEBHOOK_SECRET;
      if (!secret)
        return reply
          .code(503)
          .send(error(req, 'SOURCE_UNAVAILABLE', 'webhook authentication is not configured'));
      if (!verifyHmacSha256(raw, header(req, 'x-razorpay-signature'), secret)) {
        return reply.code(401).send(error(req, 'POLICY_DENIED', 'webhook authentication failed'));
      }
      const accountId = header(req, 'x-razorpay-account-id');
      const sourceEventId = header(req, 'x-razorpay-event-id');
      if (!accountId || !sourceEventId) {
        return reply
          .code(400)
          .send(error(req, 'SCHEMA_INVALID', 'required webhook headers are missing'));
      }
      const ctx = await resolveSourceTenant(db, 'RAZORPAY_TEST', accountId);
      if (!ctx)
        return reply
          .code(401)
          .send(error(req, 'POLICY_DENIED', 'webhook source account is unknown'));
      const parsedWebhook = parseJson(raw);
      const canonical = mapRazorpayWebhook(parsedWebhook, {
        tenantId: ctx.tenantId,
        accountId,
        sourceEventId,
        payloadHash: rawBytesHash(raw),
      });
      const parsed = SubmitEventRequest.safeParse(canonical);
      if (!parsed.success) {
        const root = isRecord(parsedWebhook) ? parsedWebhook : {};
        const quarantined = await quarantineAuthenticatedEvidence(db, ctx, {
          sourceSystem: 'RAZORPAY_TEST',
          sourceAccountId: accountId,
          sourceEventId,
          sourceEventType: typeof root.event === 'string' ? root.event : 'unmapped',
          rawBytes: raw,
          parsedPayload: parsedWebhook,
          reason: 'authenticated_webhook_unmappable',
        });
        if (quarantined.outcome === 'conflict') {
          return reply
            .code(409)
            .send(
              error(req, 'EVIDENCE_CONFLICT', 'Razorpay event id conflicts with accepted evidence'),
            );
        }
        return reply.code(202).send(
          WebhookAcceptedResponse.parse({
            schema_version: '1.0',
            request_id: req.id,
            resource_version: 0,
            data: { status: quarantined.outcome },
          }),
        );
      }
      const outcome = await acceptEvidence(db, ctx, {
        event: parsed.data,
        rawBytes: raw,
        rawRepresentation: 'exact_bytes',
        signatureStatus: 'verified',
        sourceIdentity: `RAZORPAY_TEST:${accountId}`,
      });
      if (outcome.outcome === 'conflict') {
        return reply
          .code(409)
          .send(
            error(req, 'EVIDENCE_CONFLICT', 'Razorpay event id conflicts with accepted evidence'),
          );
      }
      return reply.code(202).send(
        WebhookAcceptedResponse.parse({
          schema_version: '1.0',
          request_id: req.id,
          resource_version: 0,
          data: { status: outcome.outcome },
        }),
      );
    });
  });
}

function asBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) return body;
  throw new Error('raw evidence parser was not installed');
}

function header(req: FastifyRequest, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

interface WebhookContext {
  readonly tenantId: string;
  readonly accountId: string;
  readonly sourceEventId: string;
  readonly payloadHash: string;
}

function mapRazorpayWebhook(raw: unknown, ctx: WebhookContext): unknown {
  if (!raw || typeof raw !== 'object') return null;
  const root = raw as Record<string, unknown>;
  const sourceEventType = typeof root.event === 'string' ? root.event : '';
  const mapping: Readonly<
    Record<string, { type: CanonicalEventType; entity: 'payment' | 'order' | 'transfer' }>
  > = {
    'payment.authorized': { type: 'PaymentAuthorized', entity: 'payment' },
    'payment.captured': { type: 'PaymentCaptured', entity: 'payment' },
    'payment.failed': { type: 'PaymentFailed', entity: 'payment' },
    'order.paid': { type: 'OrderPaid', entity: 'order' },
    'transfer.processed': { type: 'TransferProcessed', entity: 'transfer' },
  };
  const selected = mapping[sourceEventType];
  if (!selected) return null;
  const payload = isRecord(root.payload) ? root.payload : null;
  const candidateWrapper = payload?.[selected.entity];
  const wrapper = isRecord(candidateWrapper) ? candidateWrapper : null;
  const entity = wrapper && isRecord(wrapper.entity) ? wrapper.entity : null;
  if (!entity || typeof entity.id !== 'string') return null;
  const createdAt =
    typeof entity.created_at === 'number' && Number.isSafeInteger(entity.created_at)
      ? new Date(entity.created_at * 1000)
      : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return null;
  const amount =
    typeof entity.amount === 'number' && Number.isSafeInteger(entity.amount)
      ? String(entity.amount)
      : null;
  const currency = entity.currency === 'INR' ? 'INR' : null;
  if ((amount == null) !== (currency == null)) return null;
  const orderId = typeof entity.order_id === 'string' ? entity.order_id : null;
  const recipientId = typeof entity.recipient === 'string' ? entity.recipient : null;
  return {
    event_id: ctx.sourceEventId,
    tenant_id: ctx.tenantId,
    source_system: 'RAZORPAY_TEST',
    source_account_id: ctx.accountId,
    source_event_id: ctx.sourceEventId,
    source_event_type: sourceEventType,
    event_type: selected.type,
    schema_version: '1.0',
    event_time: createdAt.toISOString(),
    ingested_at: new Date().toISOString(),
    source_entity_version: null,
    entity_references: {
      ...(selected.entity === 'payment' ? { payment_id: entity.id } : {}),
      ...(selected.entity === 'order' ? { order_id: entity.id } : {}),
      ...(selected.entity === 'transfer' ? { transfer_id: entity.id } : {}),
      ...(orderId ? { order_id: orderId } : {}),
      ...(recipientId ? { recipient_account_id: recipientId } : {}),
    },
    economic_subject_hint: orderId ? `order:${orderId}` : null,
    amount_minor: amount,
    currency,
    correlation_id: orderId,
    causation_id: null,
    payload_hash: ctx.payloadHash,
    raw_payload_ref: `db:ingest_events/${ctx.sourceEventId}`,
    metadata: { environment: 'test' },
    data: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function error(
  req: FastifyRequest,
  code:
    | 'SOURCE_UNAVAILABLE'
    | 'POLICY_DENIED'
    | 'SCHEMA_INVALID'
    | 'EVIDENCE_CONFLICT'
    | 'TENANT_SCOPE_REQUIRED',
  message: string,
) {
  return {
    schema_version: '1.0',
    error: { code, message, request_id: req.id, retryable: false, details: { kind: 'none' } },
  };
}
