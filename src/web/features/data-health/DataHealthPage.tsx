import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { z } from 'zod';
import { SourceHealth } from '../../../contracts/index.js';
import { useIdentity } from '../../app/identity.js';
import { asApiError } from '../../data/client.js';
import { DATA_HEALTH_STATIC } from '../../data/mocks/data-health.js';
import {
  dataHealthQueryKey,
  demoStatusQueryKey,
  getDataHealth,
  getDemoStatus,
} from '../../data/demo.js';
import { formatDatasetTime } from '../../formatting/date-time.js';
import { formatMoney } from '../../formatting/money.js';
import { ErrorState, LoadingState } from '../shell/states/StatePanels.js';

type SourceHealth = z.infer<typeof SourceHealth>;
type Capability = SourceHealth['capability'];
type Verdict = 'ready' | 'warning' | 'not_ready';

const SOURCE_LABEL: Readonly<Record<SourceHealth['source_system'], string>> = {
  RAZORPAY_TEST: 'Razorpay Test',
  SYNTHETIC_RAZORPAY_FIXTURE: 'Synthetic Razorpay Fixture',
  SYNTHETIC_OMS: 'Synthetic OMS',
  SYNTHETIC_ERP: 'Synthetic ERP',
  SYNTHETIC_BANK: 'Synthetic Bank',
  SYNTHETIC_RECOVERY: 'Synthetic recovery',
  SYNTHETIC_AGENT: 'Demo agent source',
  SYNTHETIC_ROUTE: 'Synthetic Route',
  MONEYTRACE: 'MoneyTrace',
};

/* -------------------------------------------------------------------------- */
/*  Glyphs                                                                     */
/* -------------------------------------------------------------------------- */

function CheckCircleGlyph({ size = 10 }: { readonly size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5.4 8.2 7.2 10l3.4-3.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TriangleGlyph({ size = 12 }: { readonly size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.6 14.5 13.4H1.5L8 2.6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function XCircleGlyph({ size = 10 }: { readonly size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StruckCircleGlyph({ size = 10 }: { readonly size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.6 11.4 11.4 4.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function DashedCircleGlyph({ size = 10 }: { readonly size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2.4" />
      <path d="M8 5v3.4M8 10.8v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function FlaskGlyph({
  size = 10,
  dashed = false,
}: {
  readonly size?: number;
  readonly dashed?: boolean;
}): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.2 2h3.6M6.9 2v3.6L4.1 11.6A1.6 1.6 0 0 0 5.5 14h5a1.6 1.6 0 0 0 1.4-2.4L9.1 5.6V2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashed ? '2.5 2' : undefined}
      />
    </svg>
  );
}

function RingGlyph({
  size = 10,
  dashed = false,
}: {
  readonly size?: number;
  readonly dashed?: boolean;
}): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <circle
        cx="6"
        cy="6"
        r="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={dashed ? '3 2' : undefined}
      />
    </svg>
  );
}

function InfoGlyph(): ReactElement {
  return (
    <span className="dh-info-glyph" aria-hidden="true">
      ⓘ
    </span>
  );
}

function CopyGlyph(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10.5 3.5H4A1.5 1.5 0 0 0 2.5 5v6.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RefreshGlyph({ spinning }: { readonly spinning: boolean }): ReactElement {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={spinning ? 'dh-refresh-icon dh-refresh-icon--spin' : 'dh-refresh-icon'}
    >
      <path
        d="M13.2 8a5.2 5.2 0 1 1-1.7-3.85"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M13.4 1.9v2.9h-2.9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Small shared pieces                                                        */
/* -------------------------------------------------------------------------- */

function Tooltip({
  text,
  children,
}: {
  readonly text: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="dh-tooltip" title={text}>
      {children}
      <InfoGlyph />
    </span>
  );
}

function CapabilityChip({
  capability,
  untrusted = false,
}: {
  readonly capability: Capability;
  readonly untrusted?: boolean;
}): ReactElement {
  if (capability === 'available') {
    return (
      <span className="dh-chip dh-chip--available">
        <CheckCircleGlyph size={9} />
        Available
      </span>
    );
  }
  if (capability === 'synthetic') {
    return (
      <span className={`dh-chip dh-chip--synthetic${untrusted ? ' dh-chip--dashed' : ''}`}>
        <FlaskGlyph size={9} dashed={untrusted} />
        {untrusted ? 'Synthetic · untrusted' : 'Synthetic'}
      </span>
    );
  }
  return (
    <span className="dh-chip dh-chip--absent">
      <StruckCircleGlyph size={9} />
      Absent · optional
    </span>
  );
}

function AvailabilityChip({
  status,
  size = 'md',
}: {
  readonly status: 'up' | 'stale' | 'down' | 'no_data';
  readonly size?: 'md' | 'sm';
}): ReactElement {
  const cls = `dh-chip dh-chip--${size} dh-chip--${status}`;
  if (status === 'up') {
    return (
      <span className={cls}>
        <CheckCircleGlyph size={9} />
        Up
      </span>
    );
  }
  if (status === 'stale') {
    return (
      <span className={cls}>
        <TriangleGlyph size={9} />
        Stale
      </span>
    );
  }
  if (status === 'down') {
    return (
      <span className={cls}>
        <XCircleGlyph size={9} />
        Down
      </span>
    );
  }
  return (
    <span className={cls}>
      <DashedCircleGlyph size={9} />
      No data
    </span>
  );
}

function MoneyValue({
  amountMinor,
  negate = false,
}: {
  readonly amountMinor: string;
  readonly negate?: boolean;
}): ReactElement {
  const printed = formatMoney({ amount_minor: amountMinor, currency: 'INR' }).replace(' INR', '');
  const isZero = BigInt(amountMinor) === 0n;
  return (
    <span className={negate && !isZero ? 'dh-money dh-money--danger' : 'dh-money'}>
      {negate && !isZero ? `−${printed}` : printed} <span className="dh-money-unit">INR</span>
    </span>
  );
}

function MetricCard({
  label,
  value,
  note,
  tone,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly note: string;
  readonly tone?: 'warning';
}): ReactElement {
  return (
    <div className={`dh-metric-card${tone ? ` dh-metric-card--${tone}` : ''}`}>
      <div className="dh-metric-label">{label}</div>
      <div className="dh-metric-value">{value}</div>
      <div className="dh-metric-note">{note}</div>
    </div>
  );
}

function UnmeasuredCard({
  label,
  note,
}: {
  readonly label: string;
  readonly note: string;
}): ReactElement {
  return (
    <div className="dh-metric-card dh-metric-card--unmeasured">
      <div className="dh-metric-label">
        {label}{' '}
        <span title="This prototype does not track projection staleness. The absence of a number is not an absence of incidents.">
          <InfoGlyph />
        </span>
      </div>
      <div className="dh-metric-value dh-metric-value--unmeasured">
        <StruckCircleGlyph size={12} />
        Not measured in prototype
      </div>
      <div className="dh-metric-note">{note}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Auto-refresh status                                                        */
/* -------------------------------------------------------------------------- */

function useTabVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const onChange = (): void => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

function AutoRefreshIndicator({
  hasError,
  isFetching,
  tabVisible,
}: {
  readonly hasError: boolean;
  readonly isFetching: boolean;
  readonly tabVisible: boolean;
}): ReactElement {
  const label = hasError
    ? 'Auto-refresh stopped after error'
    : !tabVisible
      ? 'Auto-refresh paused · tab hidden'
      : 'Auto-refresh on · every 5s';
  const dotClass = hasError
    ? 'dh-refresh-dot--stopped'
    : !tabVisible
      ? 'dh-refresh-dot--paused'
      : 'dh-refresh-dot--on';
  return (
    <span role="status" className="dh-autorefresh">
      <span
        aria-hidden="true"
        className={`dh-refresh-dot ${dotClass}${isFetching ? ' dh-refresh-dot--pulse' : ''}`}
      />
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Status banner                                                              */
/* -------------------------------------------------------------------------- */

function StatusBanner({
  verdict,
  workerStatus,
  databaseDown,
}: {
  readonly verdict: Verdict;
  readonly workerStatus: 'up' | 'stale' | 'down';
  readonly databaseDown: boolean;
}): ReactElement {
  if (verdict === 'not_ready') {
    return (
      <div role="alert" className="dh-banner dh-banner--critical">
        <XCircleGlyph size={17} />
        <div>
          <div className="dh-banner-title">
            {databaseDown
              ? 'Database unavailable. Case, audit and dataset reads cannot be served.'
              : `Worker heartbeat is ${workerStatus === 'down' ? 'down' : 'stale'}. New jobs may not advance; persisted read-only evidence remains available.`}
          </div>
          <p>
            {databaseDown
              ? 'This is an actual failure, so the treatment is red. Navigation, identity and environment remain visible; every data-dependent action is disabled. No connection string, hostname, driver message or stack trace is shown.'
              : 'Existing cases, audit entries and verification results are unaffected and fully readable. Commands that require the worker are disabled rather than queued silently.'}
          </p>
        </div>
      </div>
    );
  }
  if (verdict === 'warning') {
    return (
      <div role="status" className="dh-banner dh-banner--warning">
        <TriangleGlyph size={17} />
        <div>
          <div className="dh-banner-title">
            Optional Razorpay Test source unavailable. Deterministic synthetic workflows remain
            safe.
          </div>
          <p>
            Razorpay Test is an optional capability, not a demo prerequisite. Synthetic bank, Route,
            ERP and recovery evidence remain authoritative for prototype availability, and every
            conclusion stays reproducible from the seeded dataset.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div role="status" className="dh-banner dh-banner--healthy">
      <CheckCircleGlyph size={17} />
      <div>
        <div className="dh-banner-title">
          Synthetic demo ready. Required local services and synthetic sources are available.
        </div>
        <p>
          Investigation runs in offline deterministic mode. No external model and no live Razorpay
          connection are in use; conclusions come from persisted synthetic evidence only.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Readiness summary                                                          */
/* -------------------------------------------------------------------------- */

function workerCardTone(
  worker: 'up' | 'stale' | 'down' | 'no_data',
): 'good' | 'warn' | 'bad' | 'neutral' {
  if (worker === 'up') return 'good';
  if (worker === 'stale') return 'warn';
  if (worker === 'no_data') return 'neutral';
  return 'bad';
}

function ReadinessSummary({
  database,
  effectiveWorker,
  razorpayAbsent,
}: {
  readonly database: 'up' | 'down';
  readonly effectiveWorker: 'up' | 'stale' | 'down' | 'no_data';
  readonly razorpayAbsent: boolean;
}): ReactElement {
  return (
    <section aria-label="Readiness summary" className="dh-readiness">
      <h2>Readiness summary</h2>
      <div className="dh-readiness-grid">
        <div
          className={`dh-readiness-card dh-readiness-card--${database === 'up' ? 'good' : 'bad'}`}
        >
          <div className="dh-readiness-head">
            <span className="dh-readiness-tag">DATABASE</span>
            <AvailabilityChip status={database} />
          </div>
          <div className="dh-readiness-headline">
            {database === 'up' ? 'Reads and writes accepted' : 'Not reachable'}
          </div>
          {database === 'up' ? (
            <dl className="dh-readiness-dl">
              <dt>Round trip</dt>
              <dd>{DATA_HEALTH_STATIC.databaseRoundTripMs} ms</dd>
              <dt>Migration</dt>
              <dd>{DATA_HEALTH_STATIC.databaseMigration}</dd>
            </dl>
          ) : null}
          <p className="dh-readiness-safe">
            <b>Safe:</b>{' '}
            {database === 'up'
              ? 'full case, audit and evidence reads; approvals and simulated actions can be recorded.'
              : 'nothing was partially written. Reported as a status category only.'}
          </p>
        </div>

        <div className={`dh-readiness-card dh-readiness-card--${workerCardTone(effectiveWorker)}`}>
          <div className="dh-readiness-head">
            <span className="dh-readiness-tag">WORKER</span>
            <AvailabilityChip status={effectiveWorker} />
          </div>
          <div className="dh-readiness-headline">
            {effectiveWorker === 'up'
              ? 'Jobs advancing normally'
              : effectiveWorker === 'no_data'
                ? 'Status cannot be determined'
                : 'Jobs may not advance'}
          </div>
          {effectiveWorker === 'up' ? (
            <dl className="dh-readiness-dl">
              <dt>Last heartbeat</dt>
              <dd>{DATA_HEALTH_STATIC.workerLastHeartbeatSeconds} s ago</dd>
              <dt>Job lag</dt>
              <dd>1 s</dd>
              <dt>Projector lag</dt>
              <dd>2 s</dd>
            </dl>
          ) : null}
          <p className="dh-readiness-safe">
            {effectiveWorker === 'no_data' ? (
              <>
                Reported as <b>No data</b>, not as Down — an unknown state is never presented as a
                known failure.
              </>
            ) : (
              <>
                <b>Safe:</b>{' '}
                {effectiveWorker === 'up'
                  ? 'queued verification and reconciliation commands complete; projections track the event log.'
                  : 'existing persisted facts can be reviewed; queued commands may not complete.'}
              </>
            )}
          </p>
        </div>

        <div
          className={`dh-readiness-card dh-readiness-card--${razorpayAbsent ? 'warn' : 'violet'}`}
        >
          <div className="dh-readiness-head">
            <span className="dh-readiness-tag">INVESTIGATION MODE</span>
            <span className={`dh-chip ${razorpayAbsent ? 'dh-chip--warn' : 'dh-chip--violet'}`}>
              {razorpayAbsent ? <TriangleGlyph size={9} /> : <RingGlyph size={9} />}
              {razorpayAbsent ? 'Rules-only degraded' : 'Offline deterministic'}
            </span>
          </div>
          <div className="dh-readiness-headline">
            {razorpayAbsent ? 'Rules-only degraded' : 'Offline deterministic demo'}
          </div>
          <dl className="dh-readiness-dl">
            <dt>{razorpayAbsent ? 'External provider' : 'External model'}</dt>
            <dd className={razorpayAbsent ? 'dh-warn-text' : undefined}>
              {razorpayAbsent ? 'Source unavailable' : 'Not configured · not required'}
            </dd>
            <dt>Rules bundle</dt>
            <dd className="dh-mono">{DATA_HEALTH_STATIC.rulesBundleVersion}</dd>
          </dl>
          <p className="dh-readiness-safe">
            <b>Safe:</b>{' '}
            {razorpayAbsent
              ? 'deterministic rules still produce every case conclusion. '
              : 'every finding is reproducible from the seeded dataset. Same input, same conclusion, no model variance.'}
            {razorpayAbsent && (
              <>
                <b>Cannot advance:</b> narrative summarisation of new findings.
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Source capability table                                                    */
/* -------------------------------------------------------------------------- */

function SourceCapabilityTable({
  sources,
  receivedTotal,
  duplicateTotal,
  conflictTotal,
  schemaFailureTotal,
}: {
  readonly sources: readonly SourceHealth[];
  readonly receivedTotal: number;
  readonly duplicateTotal: number;
  readonly conflictTotal: number;
  readonly schemaFailureTotal: number;
}): ReactElement {
  return (
    <section aria-label="Source capability" className="dh-capability-section">
      <div className="dh-section-head">
        <h2>Source capability</h2>
        <span>Per-source counts sum to the pipeline totals below — no derived figures.</span>
      </div>
      <div className="dh-table-wrap">
        <table className="dh-table">
          <caption>Source systems with capability state and persisted data-quality counts</caption>
          <thead>
            <tr>
              <th scope="col">SOURCE SYSTEM</th>
              <th scope="col">CAPABILITY</th>
              <th scope="col" className="dh-num">
                RECEIVED
              </th>
              <th scope="col" className="dh-num">
                SIGNED
              </th>
              <th scope="col" className="dh-num">
                <Tooltip text="Received without a verifiable signature. Usable as context, never as independent verification evidence.">
                  UNSIGNED
                </Tooltip>
              </th>
              <th scope="col" className="dh-num">
                <Tooltip text="Byte-identical replays of an event already recorded. Safely ignored — no double counting, no data loss.">
                  EXACT DUPLICATES
                </Tooltip>
              </th>
              <th scope="col" className="dh-num">
                <Tooltip text="Same identity, different content. Quarantined and never used as authoritative truth; resolution requires evidence or human review.">
                  MODIFIED CONFLICTS
                </Tooltip>
              </th>
              <th scope="col" className="dh-num">
                <Tooltip text="Rejected at the ingestion boundary for failing schema validation. Never partially applied.">
                  SCHEMA FAILURES
                </Tooltip>
              </th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => {
              const untrusted = source.source_system === 'SYNTHETIC_AGENT';
              const noData = source.capability === 'absent';
              return (
                <tr key={source.source_system}>
                  <th scope="row">{SOURCE_LABEL[source.source_system]}</th>
                  <td>
                    <CapabilityChip capability={source.capability} untrusted={untrusted} />
                    {source.source_system === 'RAZORPAY_TEST' &&
                      source.capability === 'available' && (
                        <span className="dh-source-sub">Razorpay Test connected</span>
                      )}
                  </td>
                  <td className="dh-num">{noData ? 'No data' : source.received}</td>
                  <td className="dh-num">{noData ? 'No data' : source.signed}</td>
                  <td
                    className={`dh-num${!noData && source.unsigned > 0 ? ' dh-warn-text dh-strong' : ''}`}
                  >
                    {noData ? 'No data' : source.unsigned}
                  </td>
                  <td className="dh-num">{noData ? 'No data' : source.duplicate}</td>
                  <td className={`dh-num${!noData && source.conflict > 0 ? ' dh-warn-text' : ''}`}>
                    {noData ? 'No data' : source.conflict}
                  </td>
                  <td
                    className={`dh-num${!noData && source.schema_failure > 0 ? ' dh-warn-text' : ''}`}
                  >
                    {noData ? 'No data' : source.schema_failure}
                  </td>
                </tr>
              );
            })}
            <tr className="dh-totals-row">
              <th scope="row">Server-reported totals</th>
              <td className="dh-totals-note">not client-summed</td>
              <td className="dh-num dh-strong">{receivedTotal.toLocaleString('en-IN')}</td>
              <td
                className="dh-num dh-dim"
                title="Not reported by the server as an aggregate field."
              >
                —
              </td>
              <td
                className="dh-num dh-dim"
                title="Not reported by the server as an aggregate field."
              >
                —
              </td>
              <td className="dh-num dh-strong">{duplicateTotal}</td>
              <td className="dh-num dh-strong dh-warn-text">{conflictTotal}</td>
              <td className="dh-num dh-strong dh-warn-text">{schemaFailureTotal}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pipeline and data quality                                                  */
/* -------------------------------------------------------------------------- */

function PipelineQuality({
  receivedTotal,
  duplicateTotal,
  conflictTotal,
  schemaFailureTotal,
  projectorLag,
  jobLag,
  pendingVerification,
  unlinked,
  candidateLinks,
}: {
  readonly receivedTotal: number;
  readonly duplicateTotal: number;
  readonly conflictTotal: number;
  readonly schemaFailureTotal: number;
  readonly projectorLag: number;
  readonly jobLag: number;
  readonly pendingVerification: number;
  readonly unlinked: number;
  readonly candidateLinks: number;
}): ReactElement {
  return (
    <section aria-label="Pipeline and data quality" className="dh-pipeline">
      <h2>Pipeline and data quality</h2>
      <div className="dh-metric-grid">
        <MetricCard
          label="EVENTS RECEIVED"
          value={receivedTotal.toLocaleString('en-IN')}
          note="All ingested source events."
        />
        <MetricCard
          label="EXACT DUPLICATES"
          value={duplicateTotal}
          note="Identical replays safely ignored."
        />
        <MetricCard
          label="MODIFIED CONFLICTS"
          value={
            <>
              <TriangleGlyph size={12} />
              {conflictTotal}
            </>
          }
          note="Quarantined, not authoritative."
          tone="warning"
        />
        <MetricCard
          label="SCHEMA FAILURES"
          value={
            <>
              <TriangleGlyph size={12} />
              {schemaFailureTotal}
            </>
          }
          note="Rejected at the boundary."
          tone="warning"
        />
        <MetricCard
          label="PROJECTOR LAG"
          value={
            <>
              {projectorLag}
              <span className="dh-metric-unit"> s</span>
            </>
          }
          note="Read models behind the log."
        />
        <MetricCard
          label="JOB LAG"
          value={
            <>
              {jobLag}
              <span className="dh-metric-unit"> s</span>
            </>
          }
          note="Oldest queued job age."
        />
        <MetricCard
          label="PENDING VERIFICATION"
          value={pendingVerification}
          note="Awaiting evidence or closure."
        />
        <MetricCard label="UNLINKED RECORDS" value={unlinked} note="No allocation yet." />
        <MetricCard
          label="CANDIDATE LINKS"
          value={candidateLinks}
          note="Candidates, not verified links."
        />
        <UnmeasuredCard label="STALE PROJECTIONS" note="Not zero — untracked." />
      </div>
      <p className="dh-pipeline-footer">
        Every figure above is a field of <span className="dh-mono-ink">GET /v1/data-health</span>,
        schema-validated before display. No totals, ratios, percentages or trend deltas are computed
        in the browser.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Synthetic dataset panel                                                    */
/* -------------------------------------------------------------------------- */

function DatasetPanel({
  seedId,
  manifestHash,
  fixedClock,
  operator,
  onOpenController,
  manifest,
  scenarioLabel,
}: {
  readonly seedId: string | null;
  readonly manifestHash: string | null;
  readonly fixedClock: string;
  readonly operator: boolean;
  readonly onOpenController: () => void;
  readonly manifest: {
    readonly records_total: number;
    readonly records_matched: number;
    readonly unresolved_cases: number;
    readonly unsafe_candidate_matches_blocked: number;
    readonly unresolved_exposure: string;
    readonly verified_restored: string;
    readonly duplicate_collection_prevented: string;
    readonly reversed_recovery: string;
  } | null;
  readonly scenarioLabel: string | null;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const evaluated = formatDatasetTime(fixedClock);
  const copyHash = (): void => {
    if (!manifestHash) return;
    void navigator.clipboard?.writeText(manifestHash).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      },
      () => undefined,
    );
  };

  return (
    <section aria-label="Synthetic dataset manifest" className="dh-dataset-panel">
      <h2>Synthetic dataset</h2>
      {manifest ? (
        <>
          <dl className="dh-dataset-dl">
            <dt>Seed</dt>
            <dd className="dh-mono">{seedId ?? 'Not recorded'}</dd>
            <dt>Evaluated</dt>
            <dd className="dh-mono">
              {evaluated.visible.replace(/^Evaluated /, '')}{' '}
              <span className="dh-dim">({evaluated.utc.split(' ')[1]}Z)</span>
            </dd>
            <dt>Fixed demo clock</dt>
            <dd className="dh-mono">{fixedClock}</dd>
            <dt>Manifest</dt>
            <dd>
              {manifestHash ? (
                <span className="dh-hash">
                  <span className="dh-mono">
                    {manifestHash.replace('sha256:', '').slice(0, 4)}…{manifestHash.slice(-4)}
                  </span>
                  <button
                    type="button"
                    className="dh-copy"
                    aria-label="Copy full manifest hash"
                    title="Copy full manifest hash"
                    onClick={copyHash}
                  >
                    <CopyGlyph />
                  </button>
                  {copied && (
                    <span className="dh-copied" role="status">
                      copied
                    </span>
                  )}
                </span>
              ) : (
                'Not recorded'
              )}
            </dd>
          </dl>
          <div className="dh-divider" />
          <dl className="dh-manifest-dl">
            <dt>Records total</dt>
            <dd>{manifest.records_total.toLocaleString('en-IN')}</dd>
            <dt>Matched</dt>
            <dd>{manifest.records_matched.toLocaleString('en-IN')}</dd>
            <dt>Unresolved material cases</dt>
            <dd>{manifest.unresolved_cases}</dd>
            <dt>Unsafe candidates blocked</dt>
            <dd>{manifest.unsafe_candidate_matches_blocked}</dd>
            <dt>Unresolved exposure</dt>
            <dd>
              <MoneyValue amountMinor={manifest.unresolved_exposure} />
            </dd>
          </dl>
          <div className="dh-stage-box">
            <div className="dh-stage-head">
              <span className="dh-stage-tag">STAGE-DEPENDENT</span>
              {scenarioLabel && <span className="dh-stage-badge">{scenarioLabel}</span>}
            </div>
            <dl className="dh-manifest-dl dh-manifest-dl--sm">
              <dt>Verified restored</dt>
              <dd>
                <MoneyValue amountMinor={manifest.verified_restored} />
              </dd>
              <dt>Duplicate collection prevented</dt>
              <dd>
                <MoneyValue amountMinor={manifest.duplicate_collection_prevented} />
              </dd>
              <dt>Reversed</dt>
              <dd>
                <MoneyValue amountMinor={manifest.reversed_recovery} negate />
              </dd>
            </dl>
            <p>
              These three move with the scenario stage. They are not targets that exist immediately
              after a reset.
            </p>
          </div>
        </>
      ) : (
        <div className="dh-no-dataset">
          <p>
            No synthetic dataset is currently imported. An operator must import or reset the
            registered dataset before financial conclusions can be shown.
          </p>
        </div>
      )}
      <div className="dh-dataset-actions">
        <button type="button" className="dh-btn dh-btn--sm" onClick={onOpenController}>
          Open demo status
        </button>
        {operator && (
          <button type="button" className="dh-btn dh-btn--sm" onClick={onOpenController}>
            Open demo controller
          </button>
        )}
      </div>
      <p className="dh-dataset-footnote">
        Controller link renders for the operator identity only. No reset control lives on this page.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Database-down state                                                        */
/* -------------------------------------------------------------------------- */

function DatabaseDownExtra({
  onRetry,
  operator,
}: {
  readonly onRetry: () => void;
  readonly operator: boolean;
}): ReactElement {
  return (
    <div className="dh-down-panel">
      <div className="dh-down-block">
        <div className="dh-down-block-title">Source table and metrics in this state</div>
        <p>
          Every count reads <b>No data</b> — never 0, never a dash, never a cached figure presented
          as current. The dataset manifest panel shows the same, and the metric grid keeps its
          geometry so the page does not collapse.
        </p>
        <div className="dh-down-actions">
          <button type="button" className="dh-btn dh-btn--sm" onClick={onRetry}>
            Retry read
          </button>
          <span
            className="dh-btn dh-btn--sm dh-btn--disabled"
            title={
              operator
                ? 'Unavailable while the database is unreachable'
                : 'Operator identity required'
            }
          >
            Open demo controller
          </span>
          <span className="dh-down-note">auto-refresh stopped after error</span>
        </div>
      </div>
    </div>
  );
}

function WorkerStaleActions(): ReactElement {
  const disabled = ['Run verification check', 'Simulate action', 'Advance scenario'];
  return (
    <div className="dh-down-block">
      <div className="dh-down-block-title">Disabled while stale — no unsafe retry</div>
      <div className="dh-down-actions dh-down-actions--wrap">
        {disabled.map((label) => (
          <span
            key={label}
            className="dh-btn dh-btn--sm dh-btn--disabled"
            title="Unavailable while the worker heartbeat is stale"
          >
            {label}
          </span>
        ))}
        <Link className="dh-btn dh-btn--sm" to="/cases">
          Read cases
        </Link>
        <Link className="dh-btn dh-btn--sm" to="/audit">
          Export audit
        </Link>
      </div>
      <p className="dh-down-note">
        Disabled controls keep their accessible names and a reason tooltip. Nothing is auto-retried
        — an outstanding job is never resubmitted and no idempotency key is regenerated to force
        progress.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export function DataHealthPage(): ReactElement {
  const { identity } = useIdentity();
  const tabVisible = useTabVisible();
  const operator = identity.id === 'user_operator';

  const healthQuery = useQuery({
    queryKey: dataHealthQueryKey(identity.id),
    queryFn: ({ signal }) => getDataHealth(identity.id, signal),
    refetchInterval: (query) => (query.state.status === 'error' ? false : 5000),
    refetchIntervalInBackground: false,
  });
  const statusQuery = useQuery({
    queryKey: demoStatusQueryKey(identity.id),
    queryFn: ({ signal }) => getDemoStatus(identity.id, signal),
    refetchInterval: (query) => (query.state.status === 'error' ? false : 5000),
    refetchIntervalInBackground: false,
  });

  const openController = (): void => {
    window.dispatchEvent(new Event('moneytrace:open-scenarios'));
  };
  const retry = (): void => {
    void Promise.allSettled([healthQuery.refetch(), statusQuery.refetch()]);
  };

  if (healthQuery.isPending || statusQuery.isPending) {
    return (
      <div className="data-health-page">
        <DataHealthHeader />
        <LoadingState label="Loading data health" />
      </div>
    );
  }

  const firstError = healthQuery.error ?? statusQuery.error;
  if (firstError || !healthQuery.data || !statusQuery.data) {
    return (
      <div className="data-health-page">
        <DataHealthHeader />
        <ErrorState resource="data health" error={asApiError(firstError)} onRetry={retry} />
      </div>
    );
  }

  const health = healthQuery.data.data;
  const status = statusQuery.data.data;
  const razorpay = health.sources.find((s) => s.source_system === 'RAZORPAY_TEST');
  const razorpayAbsent = razorpay?.capability === 'absent';
  const databaseDown = health.database === 'down';
  const workerStatus = health.worker;
  const notReady = databaseDown || workerStatus !== 'up';
  const verdict: Verdict = notReady ? 'not_ready' : razorpayAbsent ? 'warning' : 'ready';
  const effectiveWorker: 'up' | 'stale' | 'down' | 'no_data' = databaseDown
    ? 'no_data'
    : workerStatus;
  const generated = formatDatasetTime(health.generated_at);
  const scenario = status.scenarios.find((s) => s.status !== 'queued' && s.current_step > 0);
  const scenarioLabel = scenario
    ? `${scenario.scenario_id.replaceAll('-', ' ')} · step ${scenario.completed_step} of ${scenario.total_steps}`.toUpperCase()
    : null;

  return (
    <div className="data-health-page">
      <DataHealthHeader
        generatedVisible={generated.visible.replace(/^Evaluated /, '')}
        generatedUtc={health.generated_at}
        hasError={false}
        isFetching={healthQuery.isFetching || statusQuery.isFetching}
        tabVisible={tabVisible}
        onRefresh={retry}
      />

      <StatusBanner verdict={verdict} workerStatus={workerStatus} databaseDown={databaseDown} />

      <ReadinessSummary
        database={health.database}
        effectiveWorker={effectiveWorker}
        razorpayAbsent={razorpayAbsent}
      />

      {databaseDown ? (
        <DatabaseDownExtra onRetry={retry} operator={operator} />
      ) : workerStatus === 'stale' ? (
        <WorkerStaleActions />
      ) : null}

      <SourceCapabilityTable
        sources={health.sources}
        receivedTotal={health.received_total}
        duplicateTotal={health.duplicate_total}
        conflictTotal={health.conflict_total}
        schemaFailureTotal={health.schema_failure_total}
      />

      <div className="dh-lower-grid">
        <PipelineQuality
          receivedTotal={health.received_total}
          duplicateTotal={health.duplicate_total}
          conflictTotal={health.conflict_total}
          schemaFailureTotal={health.schema_failure_total}
          projectorLag={health.projector_lag_seconds}
          jobLag={health.job_lag_seconds}
          pendingVerification={health.pending_verification}
          unlinked={health.unlinked}
          candidateLinks={health.candidate_links}
        />
        <DatasetPanel
          seedId={status.seed_id}
          manifestHash={status.manifest_hash}
          fixedClock={status.fixed_clock}
          operator={operator}
          onOpenController={openController}
          manifest={status.manifest}
          scenarioLabel={scenarioLabel}
        />
      </div>
    </div>
  );
}

function DataHealthHeader({
  generatedVisible,
  generatedUtc,
  hasError,
  isFetching,
  tabVisible,
  onRefresh,
}: {
  readonly generatedVisible?: string;
  readonly generatedUtc?: string;
  readonly hasError?: boolean;
  readonly isFetching?: boolean;
  readonly tabVisible?: boolean;
  readonly onRefresh?: () => void;
}): ReactElement {
  return (
    <>
      <nav className="mobile-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/overview">Overview</Link>
        <span aria-hidden="true">/</span>
        <strong aria-current="page">Data Health</strong>
      </nav>
      <header className="dh-header">
        <div>
          <h1>Data Health</h1>
          <p>Source capability, pipeline readiness, and persisted dataset quality.</p>
        </div>
        {generatedVisible && (
          <div className="dh-header-right">
            <span className="dh-generated">
              <span className="dh-generated-label">GENERATED</span>
              <span className="dh-mono">{generatedVisible}</span>
              <span className="dh-mono dh-dim">{generatedUtc}</span>
            </span>
            <AutoRefreshIndicator
              hasError={Boolean(hasError)}
              isFetching={Boolean(isFetching)}
              tabVisible={Boolean(tabVisible)}
            />
            <button type="button" className="dh-btn" onClick={onRefresh} disabled={isFetching}>
              <RefreshGlyph spinning={Boolean(isFetching)} />
              Refresh
            </button>
          </div>
        )}
      </header>
    </>
  );
}
