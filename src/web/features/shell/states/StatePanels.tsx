import { AlertCircle, Database, FileSearch, Lock, RefreshCw } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ApiError } from '../../../data/client.js';

/**
 * Shared route/panel states (MoneyTrace State Library.dc.html): the small set
 * of container patterns reused across every screen instead of each page
 * inventing its own empty/error/loading/denied treatment.
 */

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
  readonly icon?: ReactNode;
}): ReactElement {
  return (
    <div className="state-panel state-panel--empty">
      {icon ?? <FileSearch aria-hidden="true" size={20} />}
      <div>
        <strong>{title}</strong>
        <span>{body}</span>
        {action && (
          <button type="button" className="overview-inline-button" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

export function ErrorState({
  resource,
  error,
  onRetry,
}: {
  readonly resource: string;
  readonly error: ApiError;
  readonly onRetry: () => void;
}): ReactElement {
  const denied = error.status === 403;
  if (denied) return <PermissionDeniedState resource={resource} />;
  return (
    <div className="state-panel state-panel--error" role="alert">
      <AlertCircle aria-hidden="true" size={20} />
      <div>
        <strong>{`${resource.charAt(0).toUpperCase()}${resource.slice(1)} could not be loaded.`}</strong>
        <span>
          {error.message}
          {error.requestId ? ` Request ID ${error.requestId}.` : ''}
        </span>
        {error.retryable && (
          <button type="button" className="secondary-button" onClick={onRetry}>
            <RefreshCw aria-hidden="true" size={13} />
            Retry safe reads
          </button>
        )}
      </div>
    </div>
  );
}

export function PermissionDeniedState({ resource }: { readonly resource: string }): ReactElement {
  return (
    <div className="state-panel state-panel--denied" role="alert">
      <Lock aria-hidden="true" size={20} />
      <div>
        <strong>This demo role cannot view {resource}.</strong>
        <span>Authorization remains enforced server-side; switch demo role to continue.</span>
      </div>
    </div>
  );
}

export function NoDatasetState({
  operator,
  onOpenController,
}: {
  readonly operator: boolean;
  readonly onOpenController: () => void;
}): ReactElement {
  return (
    <div className="state-panel state-panel--empty">
      <Database aria-hidden="true" size={20} />
      <div>
        <strong>The synthetic dataset is not ready.</strong>
        <span>An operator must import or reset the registered dataset first.</span>
        {operator && (
          <button type="button" className="secondary-button" onClick={onOpenController}>
            Open demo controller
          </button>
        )}
      </div>
    </div>
  );
}

export function LoadingState({ label }: { readonly label: string }): ReactElement {
  return (
    <div className="state-panel-loading" role="status" aria-busy="true" aria-label={label}>
      <span />
      <span />
      <span />
    </div>
  );
}

export function NotFoundState({
  title,
  body,
  backTo,
  backLabel,
}: {
  readonly title: string;
  readonly body: string;
  readonly backTo: string;
  readonly backLabel: string;
}): ReactElement {
  return (
    <section className="state-panel state-panel--not-found" aria-labelledby="not-found-title">
      <p className="page-eyebrow">Not found</p>
      <h1 id="not-found-title">{title}</h1>
      <p>{body}</p>
      <Link className="text-link" to={backTo}>
        {backLabel}
      </Link>
    </section>
  );
}

export function InlineNotice({
  tone,
  children,
}: {
  readonly tone: 'info' | 'warning';
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className={`state-inline-notice state-inline-notice--${tone}`} role="status">
      {children}
    </div>
  );
}
