import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  Clock3,
  Diamond,
  Equal,
  ListFilter,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Triangle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  CaseLifecycleState,
  CaseSummary,
  FinancialOutcomeStatus,
} from '../../../contracts/index.js';
import { useIdentity } from '../../app/identity.js';
import {
  caseQueueQueryKey,
  getCaseQueue,
  getCaseQueueTotal,
  type CaseQueueQuery,
} from '../../data/cases.js';
import { asApiError } from '../../data/client.js';
import { demoStatusQueryKey, getDemoStatus } from '../../data/demo.js';
import { caseDisplay } from '../../data/mocks/cases.js';
import { formatDatasetTime } from '../../formatting/date-time.js';
import { formatMoney } from '../../formatting/money.js';
import {
  QueueDeniedState,
  QueueLoadingSkeleton,
  QueueNoDatasetState,
  QueueNoExposureState,
  QueueNoMatchesState,
  QueueReadErrorState,
} from './QueueStates.js';

const LIFECYCLE_OPTIONS: readonly CaseLifecycleState[] = [
  'candidate',
  'open',
  'investigating',
  'recommendation_ready',
  'approval_required',
  'approved',
  'executing',
  'verification_pending',
  'reconciled',
  'abstained',
  'escalated',
  'rejected',
  'expired',
  'cancelled',
  'closed_no_action',
];

const LIFECYCLE_META: Readonly<
  Record<
    CaseLifecycleState,
    { readonly label: string; readonly tone: string; readonly icon: LucideIcon }
  >
> = {
  candidate: { label: 'Candidate', tone: 'neutral', icon: CircleDashed },
  open: { label: 'Open', tone: 'slate', icon: Square },
  investigating: { label: 'Investigating', tone: 'info', icon: Diamond },
  recommendation_ready: { label: 'Recommendation ready', tone: 'info', icon: Diamond },
  approval_required: { label: 'Approval required', tone: 'purple', icon: Circle },
  approved: { label: 'Approved', tone: 'success', icon: Check },
  executing: { label: 'Executing', tone: 'warning', icon: Clock3 },
  verification_pending: { label: 'Verification pending', tone: 'warning', icon: Clock3 },
  reconciled: { label: 'Reconciled', tone: 'success', icon: Equal },
  abstained: { label: 'Abstained', tone: 'dashed', icon: CircleDashed },
  escalated: { label: 'Escalated', tone: 'danger', icon: Triangle },
  rejected: { label: 'Rejected', tone: 'danger', icon: Triangle },
  expired: { label: 'Expired', tone: 'neutral', icon: Clock3 },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: Circle },
  closed_no_action: { label: 'Closed — no action', tone: 'success', icon: Equal },
};

const OUTCOME_META: Readonly<
  Record<FinancialOutcomeStatus, { readonly tone: string; readonly icon: LucideIcon }>
> = {
  EXPECTED: { tone: 'neutral', icon: Circle },
  OBSERVED_UNVERIFIED: { tone: 'warning', icon: Square },
  DIVERGED: { tone: 'danger', icon: Zap },
  ACTION_PENDING: { tone: 'warning', icon: Square },
  VERIFIED: { tone: 'success', icon: BadgeCheck },
  REVERSED: { tone: 'slate', icon: RotateCcw },
  UNRESOLVED: { tone: 'danger', icon: AlertCircle },
};

const CONTROL_OPTIONS = ['CTL-11', 'CTL-04', 'CTL-02', 'CTL-09'] as const;
const OWNER_OPTIONS = ['A. Rao', 'S. Menon', 'K. Iyer', 'P. Shah'] as const;
const POLICY_STATUS_OPTIONS = [
  { value: 'ALLOW_AUTOMATIC', label: 'Allow automatic' },
  { value: 'REQUIRE_APPROVAL', label: 'Require approval' },
  { value: 'ADVISE', label: 'Advise' },
  { value: 'DENY', label: 'Deny' },
  { value: 'REQUIRE_MORE_EVIDENCE', label: 'Require more evidence' },
] as const;

function EvidenceBar({
  value,
}: {
  readonly value: CaseSummary['evidence_coverage'];
}): ReactElement {
  const step = value === 'complete' ? 3 : value === 'partial' ? 2 : 1;
  return (
    <span className="cq-evidence">
      <span className="cq-evidence-label">{value.charAt(0).toUpperCase() + value.slice(1)}</span>
      <span
        className="cq-evidence-bar"
        role="img"
        aria-label={`Evidence coverage ${value}, ${step} of 3`}
      >
        {[1, 2, 3].map((i) => (
          <i key={i} className={i <= step ? `is-${value}` : ''} />
        ))}
      </span>
    </span>
  );
}

function contradictionGlyph(count: number): ReactElement {
  if (count === 0) {
    return (
      <span className="cq-contra cq-contra--zero">
        <Circle aria-hidden="true" size={11} />0
      </span>
    );
  }
  return (
    <span className={`cq-contra ${count >= 2 ? 'cq-contra--high' : 'cq-contra--low'}`}>
      <Triangle aria-hidden="true" size={11} />
      {count}
    </span>
  );
}

function caseAge(openedAt: string, datasetTimestamp: string | null): string {
  if (!datasetTimestamp) return '—';
  const opened = new Date(openedAt).getTime();
  const evaluated = new Date(datasetTimestamp).getTime();
  if (Number.isNaN(opened) || Number.isNaN(evaluated)) return '—';
  return `${Math.max(0, Math.floor((evaluated - opened) / 86_400_000))}d`;
}

function openedDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function LifecycleSelect({
  selected,
  onChange,
}: {
  readonly selected: readonly CaseLifecycleState[];
  readonly onChange: (next: readonly CaseLifecycleState[]) => void;
}): ReactElement {
  const label =
    selected.length === 0
      ? 'All states'
      : selected.length === 1
        ? LIFECYCLE_META[selected[0]!].label
        : `${selected.length} selected`;
  const toggle = (state: CaseLifecycleState): void => {
    onChange(selected.includes(state) ? selected.filter((s) => s !== state) : [...selected, state]);
  };
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={`cq-select ${selected.length > 0 ? 'cq-select--active' : ''}`}
        >
          <span>{label}</span>
          <ChevronDown aria-hidden="true" size={11} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="cq-multiselect-menu" align="start" sideOffset={4}>
          {LIFECYCLE_OPTIONS.map((state) => (
            <DropdownMenu.CheckboxItem
              key={state}
              className="cq-multiselect-item"
              checked={selected.includes(state)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => toggle(state)}
            >
              <span className="cq-multiselect-check">
                <DropdownMenu.ItemIndicator>
                  <Check aria-hidden="true" size={12} />
                </DropdownMenu.ItemIndicator>
              </span>
              {LIFECYCLE_META[state].label}
            </DropdownMenu.CheckboxItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function CaseQueuePage(): ReactElement {
  const { identity } = useIdentity();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cursorStack, setCursorStack] = useState<readonly string[]>([]);

  const query: CaseQueueQuery = useMemo(() => {
    const state = searchParams.getAll('state') as CaseLifecycleState[];
    return {
      q: searchParams.get('q') ?? undefined,
      state: state.length > 0 ? state : undefined,
      control_id: searchParams.get('control_id') ?? undefined,
      evidence_coverage:
        (searchParams.get('evidence_coverage') as CaseSummary['evidence_coverage'] | null) ??
        undefined,
      owner_id: searchParams.get('owner_id') ?? undefined,
      min_exposure_minor: searchParams.get('min_exposure_minor') ?? undefined,
      max_exposure_minor: searchParams.get('max_exposure_minor') ?? undefined,
      sort: (searchParams.get('sort') as CaseQueueQuery['sort'] | null) ?? '-exposure_amount_minor',
      cursor: searchParams.get('cursor') ?? undefined,
    };
  }, [searchParams]);
  const policyStatus = searchParams.get('policy_status') ?? '';

  const statusQuery = useQuery({
    queryKey: demoStatusQueryKey(identity.id),
    queryFn: ({ signal }) => getDemoStatus(identity.id, signal),
  });
  const queueQuery = useQuery({
    queryKey: caseQueueQueryKey(identity.id, query),
    queryFn: ({ signal }) => getCaseQueue(identity.id, query, signal),
  });

  const setFilter = (key: string, value: string | null): void => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('cursor');
    setCursorStack([]);
    setSearchParams(next);
  };

  const setLifecycleStates = (states: readonly CaseLifecycleState[]): void => {
    const next = new URLSearchParams(searchParams);
    next.delete('state');
    for (const state of states) next.append('state', state);
    next.delete('cursor');
    setCursorStack([]);
    setSearchParams(next);
  };

  const clearFilters = (): void => {
    setCursorStack([]);
    setSearchParams(new URLSearchParams());
  };

  const goNext = (nextCursor: string | null): void => {
    if (!nextCursor) return;
    setCursorStack((stack) => [...stack, query.cursor ?? '']);
    const next = new URLSearchParams(searchParams);
    next.set('cursor', nextCursor);
    setSearchParams(next);
  };

  const goPrevious = (): void => {
    const stack = [...cursorStack];
    const previous = stack.pop();
    setCursorStack(stack);
    const next = new URLSearchParams(searchParams);
    if (previous) next.set('cursor', previous);
    else next.delete('cursor');
    setSearchParams(next);
  };

  const status = statusQuery.data?.data;
  const datasetTime = formatDatasetTime(status?.fixed_clock);
  let rows = queueQuery.data?.data.items ?? [];
  if (policyStatus) {
    rows = rows.filter((row) => caseDisplay(row).policyStatus === policyStatus);
  }
  const pageInfo = queueQuery.data?.data.page_info;
  const total = getCaseQueueTotal(query);
  const error = queueQuery.error ? asApiError(queueQuery.error) : null;
  const activeChips: { key: string; label: string; onRemove: () => void }[] = [];
  for (const state of query.state ?? []) {
    activeChips.push({
      key: `state:${state}`,
      label: `Lifecycle: ${LIFECYCLE_META[state].label}`,
      onRemove: () => setLifecycleStates((query.state ?? []).filter((s) => s !== state)),
    });
  }
  if (query.control_id) {
    activeChips.push({
      key: 'control_id',
      label: `Control: ${query.control_id}`,
      onRemove: () => setFilter('control_id', null),
    });
  }
  if (query.evidence_coverage) {
    activeChips.push({
      key: 'evidence_coverage',
      label: `Evidence: ${query.evidence_coverage.charAt(0).toUpperCase()}${query.evidence_coverage.slice(1)}`,
      onRemove: () => setFilter('evidence_coverage', null),
    });
  }
  if (query.owner_id) {
    activeChips.push({
      key: 'owner_id',
      label: `Owner: ${query.owner_id === 'unassigned' ? 'Unassigned' : query.owner_id}`,
      onRemove: () => setFilter('owner_id', null),
    });
  }
  if (policyStatus) {
    activeChips.push({
      key: 'policy_status',
      label: `Policy: ${POLICY_STATUS_OPTIONS.find((o) => o.value === policyStatus)?.label ?? policyStatus}`,
      onRemove: () => setFilter('policy_status', null),
    });
  }
  if (query.min_exposure_minor) {
    activeChips.push({
      key: 'min_exposure_minor',
      label: `Min ${formatMoney({ amount_minor: query.min_exposure_minor, currency: 'INR' })}`,
      onRemove: () => setFilter('min_exposure_minor', null),
    });
  }
  if (query.max_exposure_minor) {
    activeChips.push({
      key: 'max_exposure_minor',
      label: `Max ${formatMoney({ amount_minor: query.max_exposure_minor, currency: 'INR' })}`,
      onRemove: () => setFilter('max_exposure_minor', null),
    });
  }
  if (query.q) {
    activeChips.push({
      key: 'q',
      label: `Search: ${query.q}`,
      onRemove: () => setFilter('q', null),
    });
  }

  const queryPreview = useMemo(() => {
    const parts: string[] = [];
    if (query.state?.length) parts.push(`lifecycle=${query.state.join(',')}`);
    if (query.control_id) parts.push(`control_id=${query.control_id}`);
    if (query.evidence_coverage) parts.push(`evidence=${query.evidence_coverage}`);
    if (query.owner_id) parts.push(`owner=${query.owner_id}`);
    if (policyStatus) parts.push(`policy_status=${policyStatus}`);
    if (query.min_exposure_minor) parts.push(`min=${query.min_exposure_minor}`);
    if (query.max_exposure_minor) parts.push(`max=${query.max_exposure_minor}`);
    parts.push(
      `sort=${(query.sort ?? '-exposure_amount_minor').replace('-', '').replace('exposure_amount_minor', 'exposure_desc')}`,
    );
    return `?${parts.join('&')}`;
  }, [query, policyStatus]);

  let body: ReactNode;
  if (status && !status.ready) {
    body = (
      <QueueNoDatasetState
        operator={identity.id === 'user_operator'}
        viewer={identity.id === 'user_viewer'}
      />
    );
  } else if (queueQuery.isPending || statusQuery.isPending) {
    body = <QueueLoadingSkeleton />;
  } else if (error?.status === 403) {
    body = <QueueDeniedState />;
  } else if (error) {
    body = (
      <QueueReadErrorState
        error={error}
        lastSafeContext={queryPreview}
        onRetry={() => void queueQuery.refetch()}
      />
    );
  } else if (rows.length === 0) {
    body = <QueueNoMatchesState total={total} onClearFilters={clearFilters} />;
  } else if (rows.every((row) => BigInt(row.exposure.amount_minor) === 0n)) {
    body = (
      <QueueNoExposureState
        onShowVerified={() => setFilter('evidence_coverage', 'complete')}
        onShowReversed={() => {
          const next = new URLSearchParams();
          next.set('state', 'reconciled');
          setSearchParams(next);
        }}
      />
    );
  } else {
    body = (
      <>
        <div className="cq-table-scroll">
          <table className="cq-table">
            <caption className="sr-only">
              Case queue, sorted by exposure descending. Lifecycle state and financial outcome are
              separate columns.
            </caption>
            <thead>
              <tr>
                <th scope="col">CASE ID</th>
                <th
                  scope="col"
                  className="cq-num"
                  aria-sort={query.sort?.startsWith('-') ? 'descending' : 'ascending'}
                >
                  <button
                    type="button"
                    className="cq-sort-button"
                    onClick={() =>
                      setFilter(
                        'sort',
                        query.sort === '-exposure_amount_minor'
                          ? 'exposure_amount_minor'
                          : '-exposure_amount_minor',
                      )
                    }
                  >
                    EXPOSURE
                    <Triangle
                      aria-hidden="true"
                      size={8}
                      className={query.sort === 'exposure_amount_minor' ? 'cq-sort-flip' : ''}
                    />
                  </button>
                </th>
                <th scope="col">EXPECTED</th>
                <th scope="col">DIVERGENCE / CTL</th>
                <th scope="col">LIFECYCLE</th>
                <th scope="col">OUTCOME</th>
                <th scope="col">EVIDENCE</th>
                <th scope="col" className="cq-num">
                  CTRA.
                </th>
                <th scope="col">POLICY</th>
                <th scope="col">OWNER</th>
                <th scope="col">OPENED</th>
                <th scope="col">NEXT SAFE ACTION</th>
                <th scope="col">
                  <span className="sr-only">Open case</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const display = caseDisplay(row);
                const lifecycle = LIFECYCLE_META[row.lifecycle_state];
                const outcome = OUTCOME_META[row.outcome_status];
                const LifecycleIcon = lifecycle.icon;
                const OutcomeIcon = outcome.icon;
                return (
                  <tr key={row.case_id} className={index === 0 ? 'cq-row--current' : ''}>
                    <td>
                      <Link className="cq-case-link" to={`/cases/${row.case_id}`}>
                        {row.case_id}
                      </Link>
                    </td>
                    <td className="cq-num cq-money">
                      {formatMoney(row.exposure).replace(' INR', '')}
                    </td>
                    <td>{display.expected}</td>
                    <td>
                      {display.divergence}
                      <br />
                      <span className="cq-mono-dim">{row.control_id}</span>
                    </td>
                    <td>
                      <span className={`cq-pill cq-pill--${lifecycle.tone}`}>
                        <LifecycleIcon aria-hidden="true" size={10} />
                        {lifecycle.label}
                      </span>
                    </td>
                    <td>
                      <span className={`cq-outcome cq-outcome--${outcome.tone}`}>
                        <OutcomeIcon aria-hidden="true" size={11} />
                        {row.outcome_status.replace('_', ' ')}
                      </span>
                    </td>
                    <td>
                      <EvidenceBar value={row.evidence_coverage} />
                    </td>
                    <td className="cq-num">{contradictionGlyph(row.contradiction_count)}</td>
                    <td className={`cq-policy cq-policy--${display.policyTone}`}>
                      {display.policy}
                    </td>
                    <td>{row.owner_id ?? <span className="cq-mono-dim">Unassigned</span>}</td>
                    <td>
                      {openedDate(row.opened_at)}
                      <br />
                      <span className="cq-mono-dim">
                        {caseAge(row.opened_at, status?.fixed_clock ?? null)}
                      </span>
                    </td>
                    <td className="cq-next-action">{display.nextAction}</td>
                    <td className="cq-num">
                      <Link
                        className="cq-open-link"
                        to={`/cases/${row.case_id}`}
                        aria-label={`Open case ${row.case_id}`}
                      >
                        <ChevronRight aria-hidden="true" size={13} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="cq-pagination">
          <span role="status" aria-live="polite">
            Showing {(query.cursor ? Number.parseInt(query.cursor, 10) : 0) + 1}–
            {(query.cursor ? Number.parseInt(query.cursor, 10) : 0) + rows.length} of {total}{' '}
            current results
          </span>
          <span className="cq-mono-dim">cursor-based · no page numbers</span>
          <div className="cq-pagination-controls">
            <button
              type="button"
              className="secondary-button"
              disabled={cursorStack.length === 0}
              onClick={goPrevious}
            >
              <ChevronRight aria-hidden="true" size={12} style={{ transform: 'rotate(180deg)' }} />
              Previous
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!pageInfo?.has_more}
              onClick={() => goNext(pageInfo?.next_cursor ?? null)}
            >
              Next
              <ChevronRight aria-hidden="true" size={12} />
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="case-queue-page">
      <nav className="mobile-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/overview">Overview</Link>
        <span aria-hidden="true">/</span>
        <strong aria-current="page">Cases</strong>
      </nav>
      <header className="cq-header">
        <div>
          <h1>Cases</h1>
          <p>Prioritized financial divergences requiring evidence, review, or verified closure.</p>
        </div>
        <div className="cq-header-tools">
          <span className="cq-result-chip">
            <strong>{total}</strong> current results
          </span>
          <span className="cq-evaluated-chip">
            <Clock3 aria-hidden="true" size={12} />
            Evaluated{' '}
            <abbr title={datasetTime.utc}>{datasetTime.visible.replace(/^Evaluated /, '')}</abbr>
          </span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void queueQuery.refetch()}
            disabled={queueQuery.isFetching}
          >
            <RefreshCw aria-hidden="true" size={14} />
            Refresh
          </button>
        </div>
      </header>

      <section className="cq-filters" aria-label="Case filters">
        <div className="cq-filter-row">
          <label className="cq-field cq-field--search">
            <span>SEARCH</span>
            <span className="cq-input-shell">
              <Search aria-hidden="true" size={13} />
              <input
                type="search"
                placeholder="Search by Case ID or supported identifier"
                defaultValue={query.q ?? ''}
                onChange={(event) => setFilter('q', event.target.value || null)}
              />
            </span>
          </label>
          <label className="cq-field">
            <span>LIFECYCLE STATE</span>
            <LifecycleSelect selected={query.state ?? []} onChange={setLifecycleStates} />
          </label>
          <label className="cq-field">
            <span>CONTROL ID</span>
            <select
              value={query.control_id ?? ''}
              onChange={(event) => setFilter('control_id', event.target.value || null)}
            >
              <option value="">All controls</option>
              {CONTROL_OPTIONS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="cq-field">
            <span>EVIDENCE COVERAGE</span>
            <select
              value={query.evidence_coverage ?? ''}
              onChange={(event) => setFilter('evidence_coverage', event.target.value || null)}
            >
              <option value="">Any coverage</option>
              <option value="complete">Complete</option>
              <option value="partial">Partial</option>
              <option value="insufficient">Insufficient</option>
            </select>
          </label>
          <label className="cq-field">
            <span>OWNER</span>
            <select
              value={query.owner_id ?? ''}
              onChange={(event) => setFilter('owner_id', event.target.value || null)}
            >
              <option value="">Any owner</option>
              <option value="unassigned">Unassigned</option>
              {OWNER_OPTIONS.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>
          </label>
          <label className="cq-field">
            <span>POLICY STATUS</span>
            <select
              value={policyStatus}
              onChange={(event) => setFilter('policy_status', event.target.value || null)}
            >
              <option value="">Any policy status</option>
              {POLICY_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="cq-filter-row cq-filter-row--second">
          <label className="cq-field">
            <span>MIN EXPOSURE (INR)</span>
            <span className="cq-input-shell cq-input-shell--money">
              <span className="cq-rupee">₹</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="0.00"
                defaultValue={
                  query.min_exposure_minor
                    ? formatMoney({ amount_minor: query.min_exposure_minor, currency: 'INR' })
                        .replace('₹', '')
                        .replace(' INR', '')
                    : ''
                }
                onBlur={(event) => {
                  const digits = event.target.value.replace(/[^0-9]/g, '');
                  setFilter('min_exposure_minor', digits ? digits : null);
                }}
              />
            </span>
          </label>
          <label className="cq-field">
            <span>MAX EXPOSURE (INR)</span>
            <span className="cq-input-shell cq-input-shell--money">
              <span className="cq-rupee">₹</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="No maximum"
                defaultValue={
                  query.max_exposure_minor
                    ? formatMoney({ amount_minor: query.max_exposure_minor, currency: 'INR' })
                        .replace('₹', '')
                        .replace(' INR', '')
                    : ''
                }
                onBlur={(event) => {
                  const digits = event.target.value.replace(/[^0-9]/g, '');
                  setFilter('max_exposure_minor', digits ? digits : null);
                }}
              />
            </span>
          </label>
          <label className="cq-field">
            <span>SORT</span>
            <select value={query.sort} onChange={(event) => setFilter('sort', event.target.value)}>
              <option value="-exposure_amount_minor">Exposure high to low</option>
              <option value="exposure_amount_minor">Exposure low to high</option>
              <option value="-opened_at">Newest opened</option>
              <option value="opened_at">Oldest opened</option>
            </select>
          </label>
          <span className="cq-sort-help">
            default sort · options: exposure ↓, exposure ↑, newest opened, oldest opened
          </span>
          <span className="cq-query-preview">{queryPreview}</span>
        </div>
        {activeChips.length > 0 && (
          <div className="cq-chip-row">
            <span className="cq-chip-label">ACTIVE FILTERS</span>
            {activeChips.map((chip) => (
              <span className="cq-chip" key={chip.key}>
                {chip.label}
                <button
                  type="button"
                  aria-label={`Remove filter ${chip.label}`}
                  onClick={chip.onRemove}
                >
                  ×
                </button>
              </span>
            ))}
            <button type="button" className="cq-clear-link" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}
      </section>

      <section className="cq-table-card" aria-label="Case queue results">
        <div className="cq-table-heading">
          <span>Case queue</span>
          <span className="cq-table-note">sorted by exposure, descending · synthetic dataset</span>
          <span className="cq-columns-pill">
            <ListFilter aria-hidden="true" size={12} />
            All 12 columns visible at 1440 — Case ID and Exposure pinned for narrower viewports
          </span>
        </div>
        {body}
      </section>
    </div>
  );
}
