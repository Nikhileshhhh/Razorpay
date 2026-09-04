import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  Circle,
  Clock3,
  Database,
  FileSearch,
  Info,
  ShieldAlert,
  Triangle,
} from 'lucide-react';
import { useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type {
  CaseSummary,
  ClaimTruthComparison,
  DatasetManifest,
  DemoStatusView,
  EvidenceCoverage,
  LifecycleCount,
  Money,
  TrendPoint,
} from '../../../contracts/index.js';
import { useIdentity } from '../../app/identity.js';
import { asApiError } from '../../data/client.js';
import { demoStatusQueryKey, getDemoStatus } from '../../data/demo.js';
import {
  getOverview,
  getOverviewCases,
  overviewCasesQueryKey,
  overviewQueryKey,
} from '../../data/overview.js';
import { formatDatasetTime } from '../../formatting/date-time.js';
import { formatMoney } from '../../formatting/money.js';

const SCENARIO_LABELS: Readonly<Record<string, string>> = {
  'claim-reversal': 'Claim reversal',
  'missing-transfer-remediation': 'Missing transfer remediation',
  'duplicate-replay': 'Duplicate replay',
  'conflicting-bank-evidence': 'Conflicting bank evidence',
};

const CONTROL_LABELS: Readonly<Record<string, string>> = {
  'CTRL-01': 'captured payment without observed transfer',
  'CTRL-02': 'settlement timeout',
  'CTRL-03': 'open receivable',
  'CTRL-04': 'duplicate recovery risk',
  'CTRL-05': 'conflicting bank evidence',
  'CTRL-06': 'duplicate event safety',
};

const LIFECYCLE_LABELS: Readonly<Record<string, string>> = {
  candidate: 'Candidate',
  open: 'Open',
  investigating: 'Investigating',
  recommendation_ready: 'Recommendation ready',
  approval_required: 'Approval required',
  approved: 'Approved',
  executing: 'Executing',
  verification_pending: 'Awaiting verification',
  reconciled: 'Reconciled',
  abstained: 'Abstained',
  escalated: 'Escalated',
  rejected: 'Rejected',
  expired: 'Expired',
  cancelled: 'Cancelled',
  closed_no_action: 'Closed — no action',
};

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(parsed);
}

function stageLabel(status: DemoStatusView): string {
  const advanced = status.scenarios.filter(
    (scenario) => scenario.current_step > 0 || scenario.completed_step > 0,
  );
  if (advanced.length === 0) return 'Baseline dataset · no scenario advanced';
  if (advanced.length > 1) return `${advanced.length} scenario stages are present`;
  const scenario = advanced[0]!;
  const step = scenario.status === 'queued' ? scenario.current_step : scenario.completed_step;
  const state = scenario.status === 'queued' ? 'queued' : scenario.status;
  return `${SCENARIO_LABELS[scenario.scenario_id] ?? titleCase(scenario.scenario_id)} · step ${step} of ${scenario.total_steps} ${state}`;
}

function moneyRatio(value: string, maximum: bigint): string {
  if (maximum <= 0n) return '0%';
  const scaled = (BigInt(value) * 1000n) / maximum;
  return `${scaled / 10n}.${scaled % 10n}%`;
}

function countRatio(value: number, maximum: number): string {
  if (maximum <= 0) return '0%';
  return `${Math.max(2, Math.round((value / maximum) * 100))}%`;
}

function negateMoney(money: Money): Money {
  const value = BigInt(money.amount_minor);
  return { ...money, amount_minor: (-value).toString() };
}

function MetricDefinition({ children }: { readonly children: string }): ReactElement {
  return (
    <span
      className="metric-definition"
      tabIndex={0}
      aria-label={`Definition: ${children}`}
      title={children}
    >
      i
    </span>
  );
}

function MetricCard({
  title,
  definition,
  value,
  stage,
  note,
  link,
  children,
}: {
  readonly title: string;
  readonly definition: string;
  readonly value: ReactNode;
  readonly stage: string;
  readonly note?: ReactNode;
  readonly link?: { readonly label: string; readonly to: string };
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <article className="financial-metric-card">
      <div className="metric-title-row">
        <span>{title}</span>
        <MetricDefinition>{definition}</MetricDefinition>
      </div>
      <div className="metric-value">{value}</div>
      {note}
      {children}
      <div className="metric-stage">{stage}</div>
      {link && (
        <Link className="overview-text-link" to={link.to}>
          {link.label} <ArrowRight aria-hidden="true" size={13} />
        </Link>
      )}
    </article>
  );
}

/** Outline circle glyph carried on the untrusted side of the claim panel. */
function UntrustedGlyph(): ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** Outline diamond glyph marking the deterministic (server-evaluated) side. */
function DeterministicGlyph({ size = 11 }: { readonly size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 .8l5.2 5.2L6 11.2.8 6z" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** Circle-check glyph used for satisfied verification steps and a detected-nothing refund. */
function CircleCheckGlyph({ size = 12 }: { readonly size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5.4 8.2 7.2 10l3.4-3.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function moneyParts(money: Money): { readonly amount: string; readonly negative: boolean } {
  const formatted = formatMoney(money).replace(' INR', '');
  const negative = formatted.startsWith('-');
  return { amount: negative ? `−${formatted.slice(1)}` : formatted, negative };
}

function ClaimMoney({
  money,
  size = 'md',
  tone,
}: {
  readonly money: Money;
  readonly size?: 'md' | 'lg';
  readonly tone?: 'danger';
}): ReactElement {
  const { amount } = moneyParts(money);
  return (
    <span
      className={`claim-money claim-money--${size}${tone ? ` claim-money--${tone}` : ''}`}
    >
      {amount} <span className="claim-money-unit">INR</span>
    </span>
  );
}

function ClaimTruthPanel({
  comparison,
}: {
  readonly comparison: ClaimTruthComparison;
}): ReactElement {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const status = comparison.current_status;
  const reversed = status === 'REVERSED';
  const verified = status === 'VERIFIED' || status === 'PARTIALLY_VERIFIED';
  const refundDetected = BigInt(comparison.correlated_refund_amount.amount_minor) !== 0n;
  const outcomeModifier = reversed ? 'reversed' : verified ? 'verified' : 'unresolved';
  const outcomeLabel = verified
    ? 'Verified after independent evidence'
    : reversed
      ? 'Reversed — not verified'
      : `${titleCase(status.toLowerCase())} — not verified`;
  const hasEvidence = comparison.evidence_references.length > 0;

  return (
    <section className="claim-truth" aria-labelledby="claim-truth-title">
      <h2 id="claim-truth-title" className="claim-truth-kicker">
        Agent claim versus retained financial value
      </h2>
      <div className="claim-truth-card">
        <div className="claim-truth-grid">
          <div className="claim-panel claim-panel--untrusted">
            <span className="claim-badge claim-badge--untrusted">
              <UntrustedGlyph /> Untrusted agent claim
            </span>
            <div className="claim-rows">
              <div className="claim-row">
                <span className="claim-row-label">Agent-reported recovery</span>
                <ClaimMoney money={comparison.claimed_amount} />
              </div>
              <div className="claim-row">
                <span className="claim-row-label">Recovery payment observed</span>
                {comparison.recovery_payment_observed ? (
                  <span className="claim-status">
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                      <rect width="12" height="12" rx="1.5" fill="#2c3e55" />
                    </svg>
                    Yes — linked captured payment evidence
                  </span>
                ) : (
                  <span className="claim-status claim-status--muted">
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                      <rect
                        x="1"
                        y="1"
                        width="10"
                        height="10"
                        rx="1.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                      />
                    </svg>
                    No captured payment evidence observed
                  </span>
                )}
              </div>
              {comparison.route_acknowledgement && (
                <div className="claim-row">
                  <span className="claim-row-label">Route transfer acknowledgement</span>
                  <span className="claim-status claim-status--ack">
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                      <rect
                        x="1"
                        y="1"
                        width="10"
                        height="10"
                        rx="1"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeDasharray="3 2"
                      />
                    </svg>
                    Acknowledged — not verification
                  </span>
                </div>
              )}
              <p className="claim-note">
                {comparison.route_acknowledgement ? (
                  <>
                    The Route acknowledgement recorded at step 3 did <b>not</b> cause this
                    verification. It is a downstream acknowledgement of a synthetic action, and
                    carries no evidentiary weight on its own.
                  </>
                ) : (
                  <>
                    The claim and its linked payment are inputs, not conclusions. A captured payment
                    is a <span className="claim-source-fact">SOURCE FACT</span>; it does not
                    establish that value was retained.
                  </>
                )}
              </p>
              {hasEvidence ? (
                <>
                  <button
                    type="button"
                    className="claim-link claim-link--button"
                    aria-expanded={evidenceOpen}
                    aria-controls="claim-evidence-list"
                    onClick={() => setEvidenceOpen((open) => !open)}
                  >
                    View claim evidence
                    <ChevronDown
                      aria-hidden="true"
                      size={13}
                      className={evidenceOpen ? 'claim-link-chevron is-open' : 'claim-link-chevron'}
                    />
                  </button>
                  {evidenceOpen && (
                    <ul id="claim-evidence-list" className="claim-evidence-list">
                      {comparison.evidence_references.map((reference) => (
                        <li key={reference.evidence_id}>
                          <span>
                            {reference.evidence_type
                              ? titleCase(reference.evidence_type)
                              : 'Evidence'}
                          </span>
                          <code>{reference.evidence_id}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <Link className="claim-link" to="/audit">
                  View claim evidence
                </Link>
              )}
            </div>
          </div>
          <div className="claim-panel claim-panel--deterministic">
            <span className="claim-badge claim-badge--deterministic">
              <DeterministicGlyph /> Deterministic retained value
            </span>
            <div className="claim-rows">
              <div className="claim-row">
                <span className="claim-row-label">
                  Refund detected later
                  {refundDetected && (
                    <span className="claim-row-suffix"> · authoritative refund</span>
                  )}
                </span>
                {refundDetected ? (
                  <ClaimMoney
                    money={negateMoney(comparison.correlated_refund_amount)}
                    tone="danger"
                  />
                ) : (
                  <span className="claim-status claim-status--positive">
                    <CircleCheckGlyph />
                    None detected in this dataset
                  </span>
                )}
              </div>
              <div className="claim-row claim-row--total">
                <span className="claim-row-label claim-row-label--strong">Final retained value</span>
                <ClaimMoney money={comparison.final_retained_value} size="lg" />
              </div>
              <div className="claim-row">
                <span className="claim-row-label claim-row-label--strong">
                  Verified incremental recovery
                </span>
                {comparison.verified_incremental_recovery ? (
                  <ClaimMoney money={comparison.verified_incremental_recovery} size="lg" />
                ) : (
                  <span className="claim-row-nodata">No data — not independently verified</span>
                )}
              </div>
              <div className={`claim-outcome claim-outcome--${outcomeModifier}`}>
                {reversed ? (
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                    className="claim-outcome-glyph"
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
                ) : verified ? (
                  <span className="claim-outcome-glyph">
                    <DeterministicGlyph size={15} />
                  </span>
                ) : (
                  <ShieldAlert aria-hidden="true" size={15} className="claim-outcome-glyph" />
                )}
                <span className="claim-outcome-label">Outcome · {outcomeLabel}</span>
              </div>
              {comparison.verification_chain ? (
                <div className="claim-chain">
                  <span className="claim-chain-heading">Verification chain — all three required</span>
                  {comparison.verification_chain.map((step) => (
                    <span
                      key={step.step}
                      className={`claim-chain-step${step.satisfied ? '' : ' claim-chain-step--pending'}`}
                    >
                      {step.satisfied ? (
                        <CircleCheckGlyph />
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
                        </svg>
                      )}
                      {step.label}
                      {step.occurred_at && (
                        <span className="claim-chain-time">
                          {formatDatasetTime(step.occurred_at).visible.replace(/^Evaluated /, '')}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              ) : reversed ? (
                <p className="claim-note">
                  A refund correlated to the recovery payment was observed after the claim, so
                  retained value returned to zero. The agent&rsquo;s action was acknowledged; it was
                  never verified as recovered money.
                </p>
              ) : null}
              <Link className="claim-link" to="/audit">
                Open audit replay
              </Link>
            </div>
          </div>
        </div>
        <div className="claim-truth-footer">
          <span className="claim-footer-tag">Deterministic</span>
          <span className="claim-footer-eq">
            Eligible captured value − correlated refund = retained value
          </span>
          <span className="claim-footer-note">
            Evaluated server-side over the persisted dataset; no browser arithmetic.
          </span>
        </div>
      </div>
    </section>
  );
}

function LifecycleExposure({ rows }: { readonly rows: readonly LifecycleCount[] }): ReactElement {
  const maximum = rows.reduce((current, row) => {
    const amount = BigInt(row.exposure_amount.amount_minor);
    return amount > current ? amount : current;
  }, 0n);
  return (
    <section className="summary-card" aria-labelledby="lifecycle-exposure-title">
      <div className="summary-card-heading">
        <h2 id="lifecycle-exposure-title">Exposure by lifecycle state</h2>
        <span>Exact persisted values</span>
      </div>
      <div className="structured-bars">
        {rows.map((row) => (
          <div className="structured-bar" key={row.lifecycle_state}>
            <div className="bar-label-row">
              <span>{LIFECYCLE_LABELS[row.lifecycle_state] ?? titleCase(row.lifecycle_state)}</span>
              <strong>{formatMoney(row.exposure_amount)}</strong>
            </div>
            <div className="bar-track" aria-hidden="true">
              <span
                style={
                  {
                    '--bar-width': moneyRatio(row.exposure_amount.amount_minor, maximum),
                  } as CSSProperties
                }
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ResolutionDistribution({
  rows,
}: {
  readonly rows: readonly LifecycleCount[];
}): ReactElement {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <section className="summary-card" aria-labelledby="resolution-distribution-title">
      <div className="summary-card-heading">
        <h2 id="resolution-distribution-title">Case resolution distribution</h2>
        <span>{formatCount(total)} cases</span>
      </div>
      <div className="distribution-strip" aria-hidden="true">
        {rows.map((row, index) => (
          <span
            key={row.lifecycle_state}
            className={`distribution-segment distribution-segment--${(index % 4) + 1}`}
            style={{ width: countRatio(row.count, total) }}
          />
        ))}
      </div>
      <ul className="distribution-list">
        {rows.map((row, index) => (
          <li key={row.lifecycle_state}>
            <span
              className={`distribution-key distribution-key--${(index % 4) + 1}`}
              aria-hidden="true"
            />
            <span>{LIFECYCLE_LABELS[row.lifecycle_state] ?? titleCase(row.lifecycle_state)}</span>
            <strong>{formatCount(row.count)}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OpenClosedTrend({ points }: { readonly points: readonly TrendPoint[] }): ReactElement {
  const [tableOpen, setTableOpen] = useState(false);
  const maximum = Math.max(1, ...points.flatMap((point) => [point.opened, point.closed]));
  return (
    <section className="summary-card summary-card--trend" aria-labelledby="open-closed-title">
      <div className="summary-card-heading">
        <div>
          <h2 id="open-closed-title">Opened versus closed cases</h2>
          <span>Persisted daily points · UTC</span>
        </div>
        <button
          type="button"
          className="overview-inline-button"
          aria-expanded={tableOpen}
          aria-controls="trend-data-table"
          onClick={() => setTableOpen((open) => !open)}
        >
          {tableOpen ? 'Hide' : 'Show'} data table
        </button>
      </div>
      <div className="trend-legend" aria-hidden="true">
        <span>
          <i className="trend-key trend-key--opened" /> Opened
        </span>
        <span>
          <i className="trend-key trend-key--closed" /> Closed
        </span>
      </div>
      <div className="trend-chart" aria-hidden="true">
        {points.map((point) => (
          <div className="trend-day" key={point.date}>
            <div className="trend-columns">
              <span
                className="trend-column trend-column--opened"
                style={{ height: countRatio(point.opened, maximum) }}
              />
              <span
                className="trend-column trend-column--closed"
                style={{ height: countRatio(point.closed, maximum) }}
              />
            </div>
            <span>{formatDate(point.date)}</span>
          </div>
        ))}
      </div>
      {tableOpen && (
        <div className="trend-table-wrap" id="trend-data-table">
          <table>
            <caption className="sr-only">Opened and closed cases by UTC day</caption>
            <thead>
              <tr>
                <th scope="col">UTC date</th>
                <th scope="col">Opened</th>
                <th scope="col">Closed</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date}>
                  <th scope="row">{point.date}</th>
                  <td>{formatCount(point.opened)}</td>
                  <td>{formatCount(point.closed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EvidenceCoverageIndicator({ value }: { readonly value: EvidenceCoverage }): ReactElement {
  const completed = value === 'complete' ? 3 : value === 'partial' ? 2 : 1;
  return (
    <span className={`evidence-coverage evidence-coverage--${value}`}>
      <span>{titleCase(value)}</span>
      <span
        className="coverage-steps"
        role="img"
        aria-label={`Evidence coverage: ${value}, step ${completed} of 3`}
      >
        {[1, 2, 3].map((step) => (
          <i key={step} className={step <= completed ? 'is-complete' : ''} />
        ))}
      </span>
    </span>
  );
}

function caseAge(openedAt: string, datasetTimestamp: string | null): string {
  if (!datasetTimestamp) return 'Unavailable';
  const opened = new Date(openedAt).getTime();
  const evaluated = new Date(datasetTimestamp).getTime();
  if (Number.isNaN(opened) || Number.isNaN(evaluated)) return 'Unavailable';
  return `${Math.max(0, Math.floor((evaluated - opened) / 86_400_000))}d`;
}

function PrioritizedCases({
  cases,
  total,
  datasetTimestamp,
  loading,
  error,
  onRetry,
}: {
  readonly cases: readonly CaseSummary[];
  readonly total: number;
  readonly datasetTimestamp: string | null;
  readonly loading: boolean;
  readonly error: unknown;
  readonly onRetry: () => void;
}): ReactElement {
  const casesError = error ? asApiError(error) : null;
  return (
    <section className="prioritized-cases" aria-labelledby="prioritized-cases-title">
      <div className="case-preview-heading">
        <div>
          <h2 id="prioritized-cases-title">Highest material unresolved cases</h2>
          <span>
            sorted by exposure, descending · {cases.length} of {formatCount(total)} shown
          </span>
        </div>
        <Link className="overview-text-link" to="/cases?state=open&sort=-exposure_amount_minor">
          View all cases <ArrowRight aria-hidden="true" size={13} />
        </Link>
      </div>
      {loading ? (
        <div
          className="case-preview-loading"
          role="status"
          aria-busy="true"
          aria-label="Loading prioritized cases"
        >
          <span />
          <span />
          <span />
        </div>
      ) : casesError ? (
        <div className="case-preview-error" role="alert">
          <AlertCircle aria-hidden="true" size={16} />
          <span>
            Prioritized cases are unavailable.
            {casesError.requestId ? ` Request ID ${casesError.requestId}.` : ''}
          </span>
          {casesError.retryable && (
            <button type="button" className="overview-inline-button" onClick={onRetry}>
              Retry cases
            </button>
          )}
        </div>
      ) : cases.length === 0 ? (
        <div className={total === 0 ? 'no-exposure-panel' : 'case-preview-empty'}>
          {total === 0 ? (
            <Check aria-hidden="true" size={18} />
          ) : (
            <FileSearch aria-hidden="true" size={18} />
          )}
          <div>
            <strong>
              {total === 0
                ? 'No unresolved exposure in the current dataset.'
                : 'No open cases matched this preview.'}
            </strong>
            <span>
              {total === 0
                ? 'There are no open material cases to prioritize.'
                : 'The persisted overview still reports unresolved cases; open the full queue to investigate.'}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="case-table-wrap">
            <table className="case-preview-table">
              <thead>
                <tr>
                  <th scope="col">Case ID</th>
                  <th scope="col">Exposure (INR)</th>
                  <th scope="col">Control / first divergence</th>
                  <th scope="col">Lifecycle</th>
                  <th scope="col">Evidence coverage</th>
                  <th scope="col">Contra.</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Age</th>
                  <th scope="col">Next safe action</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((item) => (
                  <tr key={item.case_id}>
                    <td>
                      <Link className="case-id-link" to={`/cases/${item.case_id}`}>
                        {item.case_id}
                      </Link>
                    </td>
                    <td className="money-cell">{formatMoney(item.exposure).replace(' INR', '')}</td>
                    <td>
                      <strong>{item.control_id}</strong> ·{' '}
                      {CONTROL_LABELS[item.control_id] ?? 'registered control divergence'}
                    </td>
                    <td>
                      <span
                        className={`lifecycle-status lifecycle-status--${item.lifecycle_state}`}
                      >
                        <Triangle aria-hidden="true" size={11} />
                        {LIFECYCLE_LABELS[item.lifecycle_state] ?? titleCase(item.lifecycle_state)}
                      </span>
                    </td>
                    <td>
                      <EvidenceCoverageIndicator value={item.evidence_coverage} />
                    </td>
                    <td className={item.contradiction_count > 0 ? 'contradiction-count' : ''}>
                      {item.contradiction_count}
                    </td>
                    <td>{item.owner_id ?? 'Unassigned'}</td>
                    <td>{caseAge(item.opened_at, datasetTimestamp)}</td>
                    <td>
                      <Link className="overview-text-link" to={`/cases/${item.case_id}`}>
                        Open case
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="case-card-list">
            {cases.map((item) => (
              <article className="case-preview-card" key={item.case_id}>
                <div className="case-card-topline">
                  <Link className="case-id-link" to={`/cases/${item.case_id}`}>
                    {item.case_id}
                  </Link>
                  <strong>{formatMoney(item.exposure)}</strong>
                </div>
                <dl>
                  <div>
                    <dt>Control</dt>
                    <dd>
                      {item.control_id} ·{' '}
                      {CONTROL_LABELS[item.control_id] ?? 'registered divergence'}
                    </dd>
                  </div>
                  <div>
                    <dt>Lifecycle</dt>
                    <dd>
                      {LIFECYCLE_LABELS[item.lifecycle_state] ?? titleCase(item.lifecycle_state)}
                    </dd>
                  </div>
                  <div>
                    <dt>Evidence</dt>
                    <dd>
                      <EvidenceCoverageIndicator value={item.evidence_coverage} />
                    </dd>
                  </div>
                  <div>
                    <dt>Contradictions</dt>
                    <dd>{item.contradiction_count}</dd>
                  </div>
                  <div>
                    <dt>Owner · age</dt>
                    <dd>
                      {item.owner_id ?? 'Unassigned'} · {caseAge(item.opened_at, datasetTimestamp)}
                    </dd>
                  </div>
                </dl>
                <Link className="overview-text-link" to={`/cases/${item.case_id}`}>
                  Open case <ArrowRight aria-hidden="true" size={13} />
                </Link>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function OverviewSkeleton(): ReactElement {
  return (
    <section
      className="overview-loading"
      aria-busy="true"
      aria-label="Loading revenue integrity overview"
    >
      <div className="skeleton-line skeleton-line--title" />
      <div className="skeleton-line skeleton-line--copy" />
      <div className="skeleton-panel" />
      <div className="skeleton-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </section>
  );
}

function OverviewError({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry: () => void;
}): ReactElement {
  const apiError = asApiError(error);
  const denied = apiError.status === 403;
  return (
    <section
      className="overview-state-panel overview-state-panel--error"
      role="alert"
      aria-labelledby="overview-error-title"
    >
      <AlertCircle aria-hidden="true" size={22} />
      <div>
        <p className="section-kicker">{denied ? 'Permission denied' : 'Overview unavailable'}</p>
        <h1 id="overview-error-title">
          {denied
            ? 'This demo role cannot view the overview.'
            : 'Revenue integrity data could not be loaded.'}
        </h1>
        <p>
          {apiError.message}
          {apiError.requestId ? ` Request ID ${apiError.requestId}.` : ''}
        </p>
        {!denied && apiError.retryable && (
          <button type="button" className="secondary-button" onClick={onRetry}>
            Retry safe reads
          </button>
        )}
      </div>
    </section>
  );
}

function NoDataset({
  operator,
  onOpenController,
}: {
  readonly operator: boolean;
  readonly onOpenController: () => void;
}): ReactElement {
  return (
    <section className="overview-state-panel" aria-labelledby="no-dataset-title">
      <Database aria-hidden="true" size={24} />
      <div>
        <p className="section-kicker">No data</p>
        <h1 id="no-dataset-title">The synthetic dataset is not ready.</h1>
        <p>
          An operator must import or reset the registered dataset before financial conclusions can
          be shown.
        </p>
        {operator && (
          <button type="button" className="secondary-button" onClick={onOpenController}>
            Open demo controller
          </button>
        )}
      </div>
    </section>
  );
}

export function OverviewPage(): ReactElement {
  const { identity } = useIdentity();
  const [readingOpen, setReadingOpen] = useState(false);
  const overviewQuery = useQuery({
    queryKey: overviewQueryKey(identity.id),
    queryFn: ({ signal }) => getOverview(identity.id, signal),
  });
  const statusQuery = useQuery({
    queryKey: demoStatusQueryKey(identity.id),
    queryFn: ({ signal }) => getDemoStatus(identity.id, signal),
  });
  const casesQuery = useQuery({
    queryKey: overviewCasesQueryKey(identity.id),
    queryFn: ({ signal }) => getOverviewCases(identity.id, signal),
    enabled: Boolean(statusQuery.data?.data.ready),
  });
  const firstError = overviewQuery.error ?? statusQuery.error;
  const loading = overviewQuery.isPending || statusQuery.isPending;
  const retry = (): void => {
    void Promise.allSettled([overviewQuery.refetch(), statusQuery.refetch(), casesQuery.refetch()]);
  };
  const status = statusQuery.data?.data;
  const overview = overviewQuery.data?.data;
  const cases = casesQuery.data?.data.items ?? [];
  const datasetTime = formatDatasetTime(overview?.dataset_timestamp ?? status?.fixed_clock);
  const stage = status ? stageLabel(status) : 'Dataset stage unavailable';
  const metricStage = `${stage} · ${datasetTime.visible.replace(/^Evaluated /, '')}`;
  const lifecycleRows = useMemo(
    () =>
      [...(overview?.lifecycle_distribution ?? [])].sort((left, right) =>
        BigInt(right.exposure_amount.amount_minor) > BigInt(left.exposure_amount.amount_minor)
          ? 1
          : -1,
      ),
    [overview?.lifecycle_distribution],
  );

  if (loading) return <OverviewSkeleton />;
  if (status && !status.ready)
    return (
      <NoDataset
        operator={identity.id === 'user_operator'}
        onOpenController={() => window.dispatchEvent(new Event('moneytrace:open-scenarios'))}
      />
    );
  if (firstError || !overview || !status)
    return <OverviewError error={firstError} onRetry={retry} />;
  const manifest: DatasetManifest = overview.manifest;
  const unresolvedMoney: Money = { amount_minor: manifest.unresolved_exposure, currency: 'INR' };
  const restoredMoney: Money = { amount_minor: manifest.verified_restored, currency: 'INR' };
  const preventedMoney: Money = {
    amount_minor: manifest.duplicate_collection_prevented,
    currency: 'INR',
  };

  return (
    <div className="overview-page">
      <nav className="mobile-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/overview">Overview</Link>
        <span aria-hidden="true">/</span>
        <strong aria-current="page">Revenue integrity</strong>
      </nav>
      <header className="overview-title-block">
        <p className="page-eyebrow">Revenue integrity</p>
        <h1>Revenue Integrity Overview</h1>
        <p>Evidence-led financial outcomes from the current persisted synthetic dataset.</p>
      </header>
      <section className="overview-context-row" aria-label="Dataset and scenario context">
        <span className="record-context">
          <Database aria-hidden="true" size={13} />
          {formatCount(manifest.records_total)} synthetic lifecycle records
        </span>
        <span className="scenario-stage">
          <Triangle aria-hidden="true" size={11} />
          {stage}
        </span>
        <span className="evaluation-context">
          <Clock3 aria-hidden="true" size={13} />
          <span>Evaluated</span>
          <abbr title={datasetTime.utc}>{datasetTime.visible.replace(/^Evaluated /, '')}</abbr>
        </span>
        <button
          type="button"
          className="how-to-read"
          aria-expanded={readingOpen}
          aria-controls="how-to-read-panel"
          onClick={() => setReadingOpen((open) => !open)}
        >
          <Info aria-hidden="true" size={14} />
          How to read this page
        </button>
      </section>
      {readingOpen && (
        <aside id="how-to-read-panel" className="reading-disclosure">
          <strong>Restored, prevented, reversed, and unresolved are separate outcomes.</strong>
          <span>
            They are never netted together in the browser. Verification requires independent
            evidence; an acknowledgement alone is not verification.
          </span>
        </aside>
      )}
      {overview.claim_truth_comparison ? (
        <ClaimTruthPanel comparison={overview.claim_truth_comparison} />
      ) : (
        <section className="claim-unavailable" aria-label="Claim comparison unavailable">
          <FileSearch aria-hidden="true" size={16} />
          <span>
            <strong>No agent claim comparison in this dataset stage.</strong> The page does not
            infer or manufacture a claim.
          </span>
        </section>
      )}
      {BigInt(manifest.unresolved_exposure) === 0n && (
        <div className="no-exposure-panel">
          <Check aria-hidden="true" size={18} />
          <div>
            <strong>No unresolved exposure in the current dataset.</strong>
            <span>This is distinct from a missing dataset or unavailable source.</span>
          </div>
        </div>
      )}
      <section className="overview-section" aria-labelledby="financial-outcomes-title">
        <div className="section-heading-row">
          <div>
            <p className="section-kicker">Current persisted outcomes</p>
            <h2 id="financial-outcomes-title">Financial and control summary</h2>
          </div>
        </div>
        <div className="metric-grid">
          <MetricCard
            title="Unresolved exposure"
            definition="Value in cases with no safe closure yet. This is not a loss estimate."
            value={formatMoney(unresolvedMoney)}
            stage={metricStage}
            link={{ label: 'View cases', to: '/cases?state=open&sort=-exposure_amount_minor' }}
          />
          <MetricCard
            title="Verified restored"
            definition="Value restored and confirmed by independent bank evidence with unique allocation."
            value={formatMoney(restoredMoney)}
            stage={metricStage}
            note={
              BigInt(manifest.verified_restored) === 0n ? (
                <span className="metric-note metric-note--neutral">
                  <Circle aria-hidden="true" size={10} />
                  Zero — nothing verified in this stage
                </span>
              ) : (
                <span className="metric-note metric-note--positive">
                  <Check aria-hidden="true" size={11} />
                  Verified after independent evidence
                </span>
              )
            }
          />
          <MetricCard
            title="Duplicate collection prevented"
            definition="Value blocked before a second collection could occur. Prevention is not restoration."
            value={formatMoney(preventedMoney)}
            stage={metricStage}
            link={{
              label: 'View prevented cases',
              to: '/cases?control_id=CTRL-04&sort=-exposure_amount_minor',
            }}
          />
          <MetricCard
            title="Matched records"
            definition="Lifecycle records matched to a counterpart under the deterministic matcher."
            value={
              <>
                {formatCount(manifest.records_matched)}{' '}
                <small>of {formatCount(manifest.records_total)}</small>
              </>
            }
            stage={metricStage}
          >
            <div
              className="matched-progress"
              role="progressbar"
              aria-label={`${manifest.records_matched} of ${manifest.records_total} records matched`}
              aria-valuemin={0}
              aria-valuemax={manifest.records_total}
              aria-valuenow={manifest.records_matched}
            >
              <span
                style={{ width: countRatio(manifest.records_matched, manifest.records_total) }}
              />
            </div>
          </MetricCard>
          <MetricCard
            title="Unresolved material cases"
            definition="Open cases above the dataset materiality threshold awaiting safe review."
            value={formatCount(manifest.unresolved_cases)}
            stage={metricStage}
            link={{ label: 'View cases', to: '/cases?state=open&sort=-exposure_amount_minor' }}
          />
          <MetricCard
            title="Unsafe candidate matches blocked"
            definition="Matcher abstentions where evidence was insufficient. These are not failed matches."
            value={formatCount(manifest.unsafe_candidate_matches_blocked)}
            stage={metricStage}
            note={
              <span className="metric-note metric-note--warning">
                <ShieldAlert aria-hidden="true" size={11} />
                Abstained — unsafe link not created
              </span>
            }
            link={{
              label: 'View evidence gaps',
              to: '/cases?evidence_coverage=insufficient&sort=-exposure_amount_minor',
            }}
          />
        </div>
      </section>
      <section className="overview-section" aria-label="Operational summaries">
        <div className="operational-grid">
          <LifecycleExposure rows={lifecycleRows} />
          <ResolutionDistribution rows={overview.lifecycle_distribution} />
          <OpenClosedTrend points={overview.opened_closed_trend} />
        </div>
      </section>
      <PrioritizedCases
        cases={cases}
        total={manifest.unresolved_cases}
        datasetTimestamp={overview.dataset_timestamp}
        loading={casesQuery.isPending}
        error={casesQuery.error}
        onRetry={() => void casesQuery.refetch()}
      />
    </div>
  );
}
