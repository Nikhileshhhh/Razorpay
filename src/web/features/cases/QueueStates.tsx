import { AlertTriangle, CheckCircle2, Database, Lock, PlusSquare, RefreshCw } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { ApiError } from '../../data/client.js';

/**
 * Case Queue-specific empty/error states, matching
 * designs/design png/case queue UI images/MoneyTrace Case Queue-selection-2.png
 * exactly (copy, layout and controls), rather than the generic shared
 * StatePanels used elsewhere in the app.
 */

export function QueueLoadingSkeleton(): ReactElement {
  const columns = ['CASE ID', 'EXPOSURE (INR)', 'LIFECYCLE', 'OUTCOME', 'EVIDENCE', 'NEXT ACTION'];
  return (
    <div className="cq-skeleton" role="status" aria-busy="true">
      <div className="cq-skeleton-heading">
        Case queue <span>Loading cases…</span>
      </div>
      <div className="cq-skeleton-table">
        <div className="cq-skeleton-row cq-skeleton-row--head">
          {columns.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        {[0, 1, 2, 3].map((row) => (
          <div className="cq-skeleton-row" key={row}>
            <span className="cq-skeleton-bar cq-skeleton-bar--id" />
            <span className="cq-skeleton-bar cq-skeleton-bar--money" />
            <span className="cq-skeleton-bar" />
            <span className="cq-skeleton-bar" />
            <span className="cq-skeleton-bar" />
            <span className="cq-skeleton-bar" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function QueueNoDatasetState({
  operator,
  viewer,
}: {
  readonly operator: boolean;
  readonly viewer: boolean;
}): ReactElement {
  return (
    <div className="cq-empty-panel">
      <Database aria-hidden="true" size={22} />
      <h2>No synthetic dataset loaded</h2>
      {operator ? (
        <>
          <p>
            Import or reset the synthetic dataset to populate the queue. Financial mutations stay
            unavailable while a reset runs.
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={() => window.dispatchEvent(new Event('moneytrace:open-scenarios'))}
          >
            <PlusSquare aria-hidden="true" size={14} />
            Open demo controller
          </button>
          <span className="cq-mono-dim">shown only for user_operator</span>
        </>
      ) : (
        <>
          <p>
            There are no cases because the synthetic dataset has not been imported for this
            environment. A Demo Operator must import or reset it before the queue can show anything.
          </p>
          <p className="cq-mono-dim">
            {viewer
              ? 'Your role (Viewer) cannot import or reset data. This is not an error and no data is missing from a real system.'
              : 'Your role cannot import or reset data. This is not an error and no data is missing from a real system.'}
          </p>
        </>
      )}
    </div>
  );
}

export function QueueNoMatchesState({
  total,
  onClearFilters,
}: {
  readonly total: number;
  readonly onClearFilters: () => void;
}): ReactElement {
  return (
    <div className="cq-empty-panel cq-empty-panel--matches">
      <h2>No cases match these filters</h2>
      <p>
        All applied filters are still in the URL. Cases may exist outside this range — {total} cases
        match the dataset with no filters.
      </p>
      <button type="button" className="secondary-button" onClick={onClearFilters}>
        Clear filters
      </button>
    </div>
  );
}

export function QueueNoExposureState({
  onShowVerified,
  onShowReversed,
}: {
  readonly onShowVerified: () => void;
  readonly onShowReversed: () => void;
}): ReactElement {
  return (
    <div className="cq-no-exposure-panel">
      <span className="cq-no-exposure-chip">
        <CheckCircle2 aria-hidden="true" size={13} />
        No exposure
      </span>
      <h2>No unresolved exposure in the current dataset</h2>
      <p>
        Every material case has been closed with evidence, reversed, or reconciled. Cases still
        exist and remain readable — this is an evaluated zero, not an absence of data.
      </p>
      <div className="cq-no-exposure-actions">
        <button type="button" className="cq-no-exposure-link" onClick={onShowVerified}>
          Show verified cases
        </button>
        <button type="button" className="cq-no-exposure-link" onClick={onShowReversed}>
          Show reversed cases
        </button>
      </div>
    </div>
  );
}

export function QueueDeniedState(): ReactElement {
  return (
    <div className="cq-empty-panel">
      <Lock aria-hidden="true" size={22} />
      <h2>Viewer access to the case queue is required</h2>
      <p>
        Your current demo role does not include read access to this queue. Ask a Demo Operator to
        switch the role, then refresh the page.
      </p>
      <p className="cq-mono-dim">
        403 · the response does not state whether any queue, tenant or case exists — absence of
        access and absence of data are never distinguished here.
      </p>
    </div>
  );
}

export function QueueReadErrorState({
  error,
  lastSafeContext,
  onRetry,
}: {
  readonly error: ApiError;
  readonly lastSafeContext: string;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <div className="cq-read-error">
      <div className="cq-read-error-context">
        <span>LAST SAFE CONTEXT</span>
        <span className="cq-mono-dim">{lastSafeContext}</span>
      </div>
      <div className="cq-read-error-banner" role="alert">
        <AlertTriangle aria-hidden="true" size={17} />
        <div>
          <strong>Case queue could not be read</strong>
          <p>
            The read model did not respond. Your filters and sort are preserved and nothing was
            changed. Retry is safe — this is a read-only request.
            {error.requestId ? ` Request ID ${error.requestId}.` : ''}
          </p>
          <div className="cq-read-error-actions">
            <button type="button" className="cq-retry-button" onClick={onRetry}>
              <RefreshCw aria-hidden="true" size={13} />
              Retry read
            </button>
            <Link className="secondary-button" to="/data-health">
              View Data Health
            </Link>
          </div>
        </div>
      </div>
      <p className="cq-mono-dim">
        No mutation control is offered here. Retry re-issues the same allowlisted read with the same
        query values.
      </p>
    </div>
  );
}
