import type { z } from 'zod';
import { DataHealthResponse, SourceHealth } from '../../../contracts/index.js';

type DataHealthResponse = z.infer<typeof DataHealthResponse>;
type SourceHealth = z.infer<typeof SourceHealth>;

/**
 * Offline fallback for `GET /v1/data-health`, matching the healthy synthetic /
 * offline deterministic demo frame (MoneyTrace Data Health.dc.html, frame
 * 1a): infrastructure up, Razorpay Test available and connected, seven
 * source systems carrying the full dataset. Per-source counts sum to the
 * pipeline totals below by construction (received 1,475 / duplicate 13 /
 * conflict 4 / schema failure 4) — the server-reported totals fields are
 * still authoritative and never recomputed from these rows in the UI.
 */
const HEALTHY_SOURCES: SourceHealth[] = [
  {
    source_system: 'RAZORPAY_TEST',
    capability: 'available',
    received: 64,
    signed: 64,
    unsigned: 0,
    duplicate: 2,
    conflict: 0,
    schema_failure: 0,
  },
  {
    source_system: 'SYNTHETIC_OMS',
    capability: 'synthetic',
    received: 500,
    signed: 500,
    unsigned: 0,
    duplicate: 6,
    conflict: 1,
    schema_failure: 0,
  },
  {
    source_system: 'SYNTHETIC_ROUTE',
    capability: 'synthetic',
    received: 312,
    signed: 298,
    unsigned: 14,
    duplicate: 3,
    conflict: 2,
    schema_failure: 0,
  },
  {
    source_system: 'SYNTHETIC_BANK',
    capability: 'synthetic',
    received: 274,
    signed: 274,
    unsigned: 0,
    duplicate: 1,
    conflict: 1,
    schema_failure: 0,
  },
  {
    source_system: 'SYNTHETIC_ERP',
    capability: 'synthetic',
    received: 188,
    signed: 188,
    unsigned: 0,
    duplicate: 0,
    conflict: 0,
    schema_failure: 3,
  },
  {
    source_system: 'SYNTHETIC_RECOVERY',
    capability: 'synthetic',
    received: 96,
    signed: 96,
    unsigned: 0,
    duplicate: 0,
    conflict: 0,
    schema_failure: 0,
  },
  {
    source_system: 'SYNTHETIC_AGENT',
    capability: 'synthetic',
    received: 41,
    signed: 0,
    unsigned: 41,
    duplicate: 1,
    conflict: 0,
    schema_failure: 1,
  },
];

/** `RAZORPAY_TEST` marked genuinely absent — the optional-capability-absent variant. */
const RAZORPAY_ABSENT_SOURCES: SourceHealth[] = HEALTHY_SOURCES.map((source) =>
  source.source_system === 'RAZORPAY_TEST'
    ? {
        source_system: 'RAZORPAY_TEST',
        capability: 'absent',
        received: 0,
        signed: 0,
        unsigned: 0,
        duplicate: 0,
        conflict: 0,
        schema_failure: 0,
      }
    : source,
);

export const MOCK_DATA_HEALTH_RESPONSE: DataHealthResponse = {
  schema_version: '1.0',
  request_id: 'req_mock_data_health',
  data: {
    schema_version: '1.0',
    generated_at: '2026-08-25T06:12:08Z',
    model_mode: 'deterministic_offline',
    database: 'up',
    worker: 'up',
    sources: HEALTHY_SOURCES,
    received_total: 1475,
    duplicate_total: 13,
    conflict_total: 4,
    schema_failure_total: 4,
    projector_lag_seconds: 2,
    job_lag_seconds: 1,
    pending_verification: 9,
    unlinked: 32,
    candidate_links: 11,
    stale_projections: 0,
  },
};

/** Optional capabilities (Razorpay Test) absent — deterministic demo remains safe. */
export const MOCK_DATA_HEALTH_RAZORPAY_ABSENT_RESPONSE: DataHealthResponse = {
  ...MOCK_DATA_HEALTH_RESPONSE,
  request_id: 'req_mock_data_health_razorpay_absent',
  data: {
    ...MOCK_DATA_HEALTH_RESPONSE.data,
    sources: RAZORPAY_ABSENT_SOURCES,
    received_total: 1475 - 64,
    duplicate_total: 13 - 2,
  },
};

/** Worker heartbeat stale — demo not ready, existing reads remain safe. */
export const MOCK_DATA_HEALTH_WORKER_STALE_RESPONSE: DataHealthResponse = {
  ...MOCK_DATA_HEALTH_RESPONSE,
  request_id: 'req_mock_data_health_worker_stale',
  data: {
    ...MOCK_DATA_HEALTH_RESPONSE.data,
    worker: 'stale',
    job_lag_seconds: 252,
    projector_lag_seconds: 248,
  },
};

/** Database unreachable — shell survives, safe envelope only. */
export const MOCK_DATA_HEALTH_DOWN_RESPONSE: DataHealthResponse = {
  ...MOCK_DATA_HEALTH_RESPONSE,
  request_id: 'req_mock_data_health_down',
  data: { ...MOCK_DATA_HEALTH_RESPONSE.data, database: 'down', worker: 'down' },
};

export const DATA_HEALTH_STATIC = {
  /** Illustrative context copy with no live schema field (round-trip latency,
   * migration/heartbeat labels) — presentational only, never a data source. */
  databaseRoundTripMs: 4,
  databaseMigration: 'schema v14 applied',
  workerLastHeartbeatSeconds: 3,
  rulesBundleVersion: 'policy-bundle v12',
};
