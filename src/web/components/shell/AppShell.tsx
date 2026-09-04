import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Clock3,
  FlaskConical,
  LayoutDashboard,
  Menu,
  PlusSquare,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { DEMO_IDENTITIES, useIdentity, type DemoIdentity } from '../../app/identity.js';
import { asApiError, type ApiError } from '../../data/client.js';
import {
  dataHealthQueryKey,
  demoStatusQueryKey,
  getDataHealth,
  getDemoStatus,
} from '../../data/demo.js';
import { advanceScenario, resetScenarios } from '../../data/mocks/demo-state.js';
import { formatDatasetTime, shortenHash } from '../../formatting/date-time.js';

interface NavigationItem {
  readonly label: string;
  readonly to: string;
  readonly icon: LucideIcon;
}

const NAVIGATION: readonly NavigationItem[] = [
  { label: 'Overview', to: '/overview', icon: LayoutDashboard },
  { label: 'Cases', to: '/cases', icon: BriefcaseBusiness },
  { label: 'Approvals', to: '/approvals', icon: ShieldCheck },
  { label: 'Audit', to: '/audit', icon: ScrollText },
  { label: 'Data Health', to: '/data-health', icon: Activity },
];

const PAGE_LABELS: Readonly<Record<string, string>> = {
  '/overview': 'Overview',
  '/cases': 'Cases',
  '/approvals': 'Approvals',
  '/audit': 'Audit',
  '/data-health': 'Data Health',
};

function IconButton({
  label,
  children,
  className = '',
  disabled = false,
  expanded,
  showTooltip = true,
  onClick,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly expanded?: boolean;
  readonly showTooltip?: boolean;
  readonly onClick?: () => void;
}): ReactElement {
  const button = (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );

  if (!showTooltip) {
    return button;
  }

  return (
    <Tooltip.Root delayDuration={250}>
      <Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip-content" sideOffset={7}>
          {label}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function TraceMark({
  size = 20,
  showOrigin = true,
}: {
  readonly size?: number;
  readonly showOrigin?: boolean;
}): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M2 14.5c3.2 0 3.6-9 6.6-9s3.4 6 5.2 6c1.3 0 1.8-1.6 1.8-3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {showOrigin && <circle cx="2" cy="14.5" r="1.7" className="trace-mark-origin" />}
      <circle cx="16" cy="8.5" r="1.7" fill="currentColor" />
    </svg>
  );
}

function Brand({
  compact = false,
  drawer = false,
}: {
  readonly compact?: boolean;
  readonly drawer?: boolean;
}): ReactElement {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <span className="brand-mark">
        <TraceMark size={compact || drawer ? 18 : 20} showOrigin={!compact && !drawer} />
      </span>
      {!compact && (
        <span className="brand-copy">
          <strong>MoneyTrace</strong>
          <small>Revenue integrity control plane</small>
        </span>
      )}
    </div>
  );
}

export function EnvironmentBadge({
  compact = false,
}: {
  readonly compact?: boolean;
}): ReactElement {
  return (
    <span
      className={`environment-badge ${compact ? 'environment-badge--compact' : ''}`}
      aria-label="Synthetic Demo environment"
    >
      <FlaskConical aria-hidden="true" size={compact ? 11 : 13} />
      {compact ? 'Synthetic' : 'Synthetic Demo'}
    </span>
  );
}

function NavigationLinks({
  compact = false,
  drawer = false,
  degraded,
  onNavigate,
}: {
  readonly compact?: boolean;
  readonly drawer?: boolean;
  readonly degraded: boolean;
  readonly onNavigate?: () => void;
}): ReactElement {
  const location = useLocation();
  return (
    <Fragment>
      {NAVIGATION.map((item) => {
        const Icon = item.icon;
        const isHealth = item.to === '/data-health';
        const isActive =
          location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
        const accessibleLabel = compact
          ? `${item.label}${isHealth && degraded ? ', degraded' : ''}`
          : undefined;
        return (
          <Tooltip.Root key={item.to} delayDuration={250}>
            <Tooltip.Trigger asChild>
              <NavLink
                className={`nav-link ${isActive ? 'nav-link--active' : ''}`}
                to={item.to}
                aria-label={accessibleLabel}
                onClick={onNavigate}
              >
                <Icon aria-hidden="true" size={compact ? 18 : 16} />
                {!compact && <span className="nav-label">{item.label}</span>}
                {isHealth &&
                  degraded &&
                  (drawer ? (
                    <span className="nav-degraded-label">
                      <AlertTriangle aria-hidden="true" size={12} />
                      Degraded
                    </span>
                  ) : (
                    <AlertTriangle
                      className="nav-warning"
                      aria-label="Degraded"
                      role="img"
                      size={14}
                    />
                  ))}
              </NavLink>
            </Tooltip.Trigger>
            {compact && (
              <Tooltip.Portal>
                <Tooltip.Content className="tooltip-content" side="right" sideOffset={8}>
                  {item.label}
                  {isHealth && degraded ? ' · Degraded' : ''}
                  <Tooltip.Arrow className="tooltip-arrow" />
                </Tooltip.Content>
              </Tooltip.Portal>
            )}
          </Tooltip.Root>
        );
      })}
    </Fragment>
  );
}

function PrimaryNavigation({
  degraded,
  seedId,
  expanded,
  onExpand,
}: {
  readonly degraded: boolean;
  readonly seedId?: string | null;
  readonly expanded: boolean;
  readonly onExpand: () => void;
}): ReactElement {
  return (
    <aside className="sidebar">
      <div className="sidebar-full">
        <Brand />
      </div>
      <div className="sidebar-rail">
        <IconButton
          label="Expand navigation"
          className="rail-expand"
          expanded={expanded}
          onClick={onExpand}
        >
          <Menu aria-hidden="true" size={17} />
        </IconButton>
        <Brand compact />
      </div>
      <nav className="nav-list" aria-label="Primary navigation">
        <div className="nav-full">
          <NavigationLinks degraded={degraded} />
        </div>
        <div className="nav-compact">
          <NavigationLinks compact degraded={degraded} />
        </div>
      </nav>
      <div className="sidebar-footnote">
        <span>dataset {seedId ?? 'unavailable'}</span>
        <span>no live connection</span>
      </div>
    </aside>
  );
}

export function DemoRoleSwitcher({
  compact = false,
  detail,
}: {
  readonly compact?: boolean;
  readonly detail?: 'drawer' | 'sheet';
}): ReactElement {
  const { identity, isSwitching, switchingTo, switchIdentity } = useIdentity();
  const visibleIdentity = switchingTo ?? identity;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={`role-trigger ${compact ? 'role-trigger--compact' : ''} ${detail ? `role-trigger--${detail}` : ''}`}
          aria-label={compact ? `Demo role: ${visibleIdentity.label}` : undefined}
          aria-busy={isSwitching || undefined}
          disabled={isSwitching}
        >
          <span className="role-avatar" aria-hidden="true">
            {visibleIdentity.initials}
          </span>
          {!compact && (
            <span className="role-trigger-copy">
              {detail ? (
                <>
                  <strong>
                    {isSwitching ? `Switching to ${visibleIdentity.label}…` : visibleIdentity.label}
                  </strong>
                  <small>{visibleIdentity.id}</small>
                </>
              ) : (
                <>
                  <small>DEMO ROLE</small>
                  <strong>
                    {isSwitching ? `Switching to ${visibleIdentity.label}…` : visibleIdentity.label}
                  </strong>
                </>
              )}
            </span>
          )}
          {!compact &&
            (detail ? (
              <span className="role-change-label">
                {detail === 'sheet' ? 'Change role' : 'Change'}
              </span>
            ) : (
              <ChevronDown className="role-chevron" aria-hidden="true" size={12} />
            ))}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="role-menu" align="end" sideOffset={8}>
          <div className="role-menu-heading">SEEDED DEMO IDENTITIES · NOT AUTHENTICATION</div>
          <DropdownMenu.RadioGroup
            value={identity.id}
            onValueChange={(value) => void switchIdentity(value as DemoIdentity['id'])}
          >
            {DEMO_IDENTITIES.map((candidate) => (
              <DropdownMenu.RadioItem
                key={candidate.id}
                value={candidate.id}
                className="role-menu-item"
              >
                <span className="role-menu-indicator" aria-hidden="true">
                  <DropdownMenu.ItemIndicator>
                    <Check size={14} />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span className="role-menu-copy">
                  <strong>{candidate.label}</strong>
                  <small>{candidate.id}</small>
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Breadcrumbs({ page }: { readonly page: string }): ReactElement {
  return (
    <nav className="breadcrumbs" aria-label="Page breadcrumb">
      <NavLink to="/overview">Overview</NavLink>
      <span aria-hidden="true">/</span>
      <strong aria-current="page">{page}</strong>
    </nav>
  );
}

export function DatasetContext({
  fixedClock,
  manifestHash,
  onCopy,
}: {
  readonly fixedClock?: string | null;
  readonly manifestHash?: string | null;
  readonly onCopy: () => void;
}): ReactElement {
  const datasetTime = formatDatasetTime(fixedClock);
  const shortTime = datasetTime.visible.replace(/^Evaluated /, '');
  return (
    <div className="dataset-context">
      <div className="dataset-time-chip">
        <Clock3 aria-hidden="true" size={13} />
        <span>Evaluated</span>
        <Tooltip.Root delayDuration={250}>
          <Tooltip.Trigger asChild>
            <abbr tabIndex={0} title={datasetTime.utc}>
              {shortTime}
            </abbr>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="tooltip-content" sideOffset={7}>
              {datasetTime.utc}
              <Tooltip.Arrow className="tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
      <div className="manifest-chip">
        <span>Manifest</span>
        <strong>{shortenHash(manifestHash).replace(/^Manifest /, '')}</strong>
        <IconButton label="Copy full manifest hash" disabled={!manifestHash} onClick={onCopy}>
          <Clipboard aria-hidden="true" size={13} />
        </IconButton>
      </div>
    </div>
  );
}

function SourceStatus({
  connected,
  detailed = false,
}: {
  readonly connected: boolean;
  readonly detailed?: boolean;
}): ReactElement {
  return connected ? (
    <span className="source-status source-status--connected">
      <Check aria-hidden="true" size={12} />
      Razorpay Test connected
    </span>
  ) : (
    <span className="source-status source-status--unavailable">
      <AlertCircle aria-hidden="true" size={12} />
      {detailed ? 'Razorpay Test — source unavailable' : 'Source unavailable'}
    </span>
  );
}

export function GlobalStatusBanner({
  tone,
  title,
  children,
  action,
  dismissLabel,
  onDismiss,
}: {
  readonly tone: 'degraded' | 'reset' | 'error';
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly dismissLabel?: string;
  readonly onDismiss?: () => void;
}): ReactElement {
  const Icon = tone === 'reset' ? RefreshCw : AlertTriangle;
  return (
    <section
      className={`status-banner status-banner--${tone}`}
      aria-label={title}
      role={tone === 'reset' || tone === 'error' ? 'alert' : 'status'}
    >
      <Icon aria-hidden="true" size={16} />
      <div className="status-banner-copy">
        <strong>{title}</strong> <span>{children}</span>
      </div>
      {action && <div className="status-banner-action">{action}</div>}
      {onDismiss && dismissLabel && (
        <IconButton
          label={dismissLabel}
          className="banner-dismiss"
          showTooltip={false}
          onClick={onDismiss}
        >
          <X aria-hidden="true" size={14} />
        </IconButton>
      )}
    </section>
  );
}

function errorBanner(error: ApiError, retry: () => void): ReactElement {
  const denied = error.status === 403;
  return (
    <GlobalStatusBanner
      tone="error"
      title={denied ? 'Action refused by server' : 'Source unavailable'}
      action={
        <button className="banner-button" type="button" onClick={retry}>
          Retry safe reads
        </button>
      }
    >
      {denied
        ? 'This demo role is not permitted. Authorization remains enforced server-side;'
        : 'The shell is available, but current dataset context could not be verified.'}
      {error.requestId ? ` Request ID ${error.requestId}.` : ''}
    </GlobalStatusBanner>
  );
}

function NavigationDrawer({
  open,
  onOpenChange,
  degraded,
  returnFocusLabel,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly degraded: boolean;
  readonly returnFocusLabel: 'Open navigation' | 'Expand navigation';
}): ReactElement {
  const railDrawer = returnFocusLabel === 'Expand navigation';
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content
          className={`drawer-content navigation-drawer ${railDrawer ? 'navigation-drawer--rail' : 'navigation-drawer--mobile'}`}
          aria-describedby={undefined}
          onEscapeKeyDown={() => onOpenChange(false)}
          onKeyDownCapture={(event) => {
            if (event.key === 'Escape') onOpenChange(false);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document
              .querySelector<HTMLButtonElement>(`[aria-label="${returnFocusLabel}"]`)
              ?.focus();
          }}
        >
          {railDrawer ? (
            <>
              <div className="rail-drawer-heading">
                <Dialog.Title>MoneyTrace</Dialog.Title>
                <Dialog.Close asChild>
                  <IconButton label="Collapse navigation" showTooltip={false}>
                    <X aria-hidden="true" size={15} />
                  </IconButton>
                </Dialog.Close>
              </div>
              <p className="rail-drawer-subtitle">Revenue integrity control plane</p>
            </>
          ) : (
            <>
              <div className="drawer-heading">
                <Brand drawer />
                <Dialog.Close asChild>
                  <IconButton label="Close navigation" showTooltip={false}>
                    <X aria-hidden="true" size={17} />
                  </IconButton>
                </Dialog.Close>
              </div>
              <EnvironmentBadge />
              <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            </>
          )}
          <nav className="mobile-nav-list" aria-label="Primary navigation">
            <NavigationLinks drawer degraded={degraded} onNavigate={() => onOpenChange(false)} />
          </nav>
          {!railDrawer && (
            <div className="drawer-role">
              <span className="drawer-role-label">DEMO ROLE</span>
              <DemoRoleSwitcher detail="drawer" />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DatasetControlsSheet({
  open,
  onOpenChange,
  fixedClock,
  manifestHash,
  connected,
  refreshing,
  showScenarios,
  onCopy,
  onRefresh,
  onShowScenarios,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly fixedClock?: string | null;
  readonly manifestHash?: string | null;
  readonly connected: boolean;
  readonly refreshing: boolean;
  readonly showScenarios: boolean;
  readonly onCopy: () => void;
  readonly onRefresh: () => void;
  readonly onShowScenarios: () => void;
}): ReactElement {
  const time = formatDatasetTime(fixedClock);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content
          className="dataset-sheet"
          aria-describedby={undefined}
          onEscapeKeyDown={() => onOpenChange(false)}
          onKeyDownCapture={(event) => {
            if (event.key === 'Escape') onOpenChange(false);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.querySelector<HTMLButtonElement>('.mobile-dataset-trigger')?.focus();
          }}
        >
          <span className="sheet-handle" aria-hidden="true" />
          <div className="drawer-heading">
            <Dialog.Title>Dataset &amp; demo controls</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Close dataset and demo controls" showTooltip={false}>
                <X aria-hidden="true" size={17} />
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="dataset-sheet-details">
            <div className="sheet-row sheet-row--stacked">
              <span>EVALUATED</span>
              <strong>{time.visible.replace(/^Evaluated /, '')}</strong>
              <small>{time.utc}</small>
            </div>
            <div className="sheet-row">
              <span>
                <span>MANIFEST</span>
                <strong className="mono">
                  {shortenHash(manifestHash).replace(/^Manifest /, '')}
                </strong>
                <small>Read-only forensic metadata</small>
              </span>
              <IconButton label="Copy full manifest hash" disabled={!manifestHash} onClick={onCopy}>
                <Clipboard aria-hidden="true" size={15} />
              </IconButton>
            </div>
            <div className="sheet-row sheet-row--stacked">
              <span>DATA SOURCES</span>
              <SourceStatus connected={connected} detailed />
              <span className="synthetic-source-status">
                <Check aria-hidden="true" size={12} />
                Synthetic bank &amp; Route evidence available
              </span>
            </div>
          </div>
          <div className="sheet-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onRefresh}
              disabled={refreshing}
            >
              <RefreshCw aria-hidden="true" size={15} />
              Refresh current page
            </button>
            {showScenarios && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  onOpenChange(false);
                  onShowScenarios();
                }}
              >
                <PlusSquare aria-hidden="true" size={15} />
                Demo scenarios<span className="button-note">operator only</span>
              </button>
            )}
            <DemoRoleSwitcher detail="sheet" />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ScenarioRow {
  readonly scenario_id: string;
  readonly current_step: number;
  readonly completed_step: number;
  readonly total_steps: number;
  readonly status: 'queued' | 'completed' | 'failed';
}

function ScenarioStatusDrawer({
  open,
  onOpenChange,
  scenarios,
  fixedClock,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly scenarios: readonly ScenarioRow[];
  readonly fixedClock?: string | null;
}): ReactElement {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(scenarios[0]?.scenario_id ?? null);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [resetView, setResetView] = useState<'hidden' | 'confirm' | 'progress' | 'done'>('hidden');

  const rows = scenarios;
  const active = rows.find((row) => row.scenario_id === selected) ?? rows[0] ?? null;

  // Refresh every read model that derives from the shared demo-scenario state,
  // so the Overview agent-claim panel, the KPI cards and this drawer all
  // re-render from the newly-advanced state.
  const refreshDemoViews = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['overview'] });
    void queryClient.invalidateQueries({ queryKey: ['demo-status'] });
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
  };

  const advance = (row: ScenarioRow): void => {
    setAdvancing(row.scenario_id);
    window.setTimeout(() => {
      advanceScenario(row.scenario_id);
      refreshDemoViews();
      setAdvancing(null);
    }, 650);
  };

  const runReset = (): void => {
    setResetView('progress');
    window.setTimeout(() => {
      resetScenarios();
      refreshDemoViews();
      setResetView('done');
    }, 900);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setResetView('hidden');
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content
          className="drawer-content scenario-drawer"
          aria-describedby="scenario-note"
          onEscapeKeyDown={() => onOpenChange(false)}
          onKeyDownCapture={(event) => {
            if (event.key === 'Escape') onOpenChange(false);
          }}
        >
          <div className="drawer-heading">
            <div>
              <p className="page-eyebrow">Synthetic orchestration · operator only</p>
              <Dialog.Title>Demo scenario controller</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close demo scenarios" showTooltip={false}>
                <X aria-hidden="true" size={17} />
              </IconButton>
            </Dialog.Close>
          </div>

          {resetView !== 'hidden' ? (
            <div className="reset-panel">
              {resetView === 'confirm' && (
                <>
                  <p id="scenario-note" className="drawer-intro">
                    This resets the registered synthetic dataset (seed{' '}
                    <code>moneytrace_demo_v1</code>) back to its baseline. Every scenario step above
                    returns to queued at step 0. This is a demo-only reset; it never touches real
                    data.
                  </p>
                  <div className="approval-decision-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setResetView('hidden')}
                    >
                      Cancel
                    </button>
                    <button type="button" className="primary-button" onClick={runReset}>
                      <RefreshCw aria-hidden="true" size={14} />
                      Confirm reset
                    </button>
                  </div>
                </>
              )}
              {resetView === 'progress' && (
                <div className="approval-submitting" role="status" aria-busy="true">
                  <span />
                  <span />
                  <span />
                  <p>Reset in progress — financial mutations are temporarily unavailable.</p>
                </div>
              )}
              {resetView === 'done' && (
                <div className="approval-success" role="status">
                  <Check aria-hidden="true" size={26} />
                  <strong>Dataset reset complete.</strong>
                  <p>All scenarios returned to their baseline queued state.</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setResetView('hidden')}
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <p id="scenario-note" className="drawer-intro">
                Advance a registered scenario one step at a time, or reset the whole dataset to its
                baseline. Every step here is durably applied server-side once connected; today it is
                simulated locally for review.
              </p>
              <div className="fixed-clock">
                <Clock3 aria-hidden="true" size={16} />
                <span>Fixed demo clock</span>
                <strong>{formatDatasetTime(fixedClock).visible.replace('Evaluated ', '')}</strong>
              </div>
              <div className="scenario-list">
                {rows.length === 0 ? (
                  <p className="empty-copy">No registered scenario state is available.</p>
                ) : (
                  rows.map((scenario) => (
                    <article
                      className={`scenario-card ${selected === scenario.scenario_id ? 'scenario-card--selected' : ''}`}
                      key={scenario.scenario_id}
                      onClick={() => setSelected(scenario.scenario_id)}
                    >
                      <div>
                        <h3>{scenario.scenario_id.replaceAll('-', ' ')}</h3>
                        <p>
                          Completed step {scenario.completed_step} of {scenario.total_steps}
                        </p>
                      </div>
                      <span className={`scenario-status scenario-status--${scenario.status}`}>
                        {scenario.status}
                      </span>
                      <button
                        type="button"
                        className="secondary-button scenario-advance-button"
                        disabled={
                          scenario.completed_step >= scenario.total_steps ||
                          scenario.status === 'queued' ||
                          advancing === scenario.scenario_id
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          advance(scenario);
                        }}
                      >
                        {advancing === scenario.scenario_id ? 'Advancing…' : 'Advance step'}
                      </button>
                    </article>
                  ))
                )}
              </div>
              {active === null || active === undefined ? null : (
                <p className="cq-mono-dim scenario-active-note">
                  step queued waits for the worker to apply it — the badge only turns
                  &quot;completed&quot; once that write is durable, never on the request alone.
                </p>
              )}
              <div className="reset-trigger-row">
                <button
                  type="button"
                  className="secondary-button secondary-button--danger"
                  onClick={() => setResetView('confirm')}
                >
                  Reset demo dataset
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ApplicationHeader({
  page,
  fixedClock,
  manifestHash,
  connected,
  refreshing,
  navigationOpen,
  datasetOpen,
  scenarioOpen,
  onOpenNavigation,
  onOpenDataset,
  onRefresh,
  onCopy,
  onShowScenarios,
}: {
  readonly page: string;
  readonly fixedClock?: string | null;
  readonly manifestHash?: string | null;
  readonly connected: boolean;
  readonly refreshing: boolean;
  readonly navigationOpen: boolean;
  readonly datasetOpen: boolean;
  readonly scenarioOpen: boolean;
  readonly onOpenNavigation: () => void;
  readonly onOpenDataset: () => void;
  readonly onRefresh: () => void;
  readonly onCopy: () => void;
  readonly onShowScenarios: () => void;
}): ReactElement {
  const { identity } = useIdentity();
  const time = formatDatasetTime(fixedClock).visible.replace(/^Evaluated /, '');
  return (
    <header className="application-header">
      <div className="desktop-header desktop-header-primary">
        <div className="tablet-wordmark">MoneyTrace</div>
        <Breadcrumbs page={page} />
        <DatasetContext fixedClock={fixedClock} manifestHash={manifestHash} onCopy={onCopy} />
        {identity.id !== 'user_operator' && (
          <span className="desktop-source-status">
            <SourceStatus connected={connected} />
          </span>
        )}
        <EnvironmentBadge />
        <IconButton label="Refresh current page" disabled={refreshing} onClick={onRefresh}>
          <RefreshCw aria-hidden="true" size={15} />
        </IconButton>
        <DemoRoleSwitcher />
        {identity.id === 'user_operator' && (
          <button
            type="button"
            className="scenario-button"
            aria-expanded={scenarioOpen}
            onClick={onShowScenarios}
          >
            <PlusSquare aria-hidden="true" size={13} />
            Demo scenarios
          </button>
        )}
      </div>
      <div className="tablet-metadata-row">
        <DatasetContext fixedClock={fixedClock} manifestHash={manifestHash} onCopy={onCopy} />
        <SourceStatus connected={connected} />
      </div>
      <div className="mobile-topbar">
        <IconButton label="Open navigation" expanded={navigationOpen} onClick={onOpenNavigation}>
          <Menu aria-hidden="true" size={18} />
        </IconButton>
        <span className="mobile-wordmark">MoneyTrace</span>
        <EnvironmentBadge compact />
        <DemoRoleSwitcher compact />
      </div>
      <button
        type="button"
        className="mobile-dataset-trigger"
        aria-expanded={datasetOpen}
        aria-label={`Evaluated ${time}. Open dataset and demo controls`}
        onClick={onOpenDataset}
      >
        <Clock3 aria-hidden="true" size={12} />
        <span>
          Evaluated <strong>{time.replace(/ 2026,/, ',')}</strong>
        </span>
        <span className="dataset-trigger-label">
          Dataset &amp; controls <ChevronRight aria-hidden="true" size={12} />
        </span>
      </button>
    </header>
  );
}

function SwitchingPlaceholder(): ReactElement {
  return (
    <div
      className="switching-placeholder"
      aria-busy="true"
      aria-label="Refreshing role-sensitive content"
    >
      <span />
      <span />
      <span />
    </div>
  );
}

export function AppShell(): ReactElement {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { identity, isSwitching, announcement, announce } = useIdentity();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [navigationReturnLabel, setNavigationReturnLabel] = useState<
    'Open navigation' | 'Expand navigation'
  >('Open navigation');
  const [datasetOpen, setDatasetOpen] = useState(false);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [degradedDismissed, setDegradedDismissed] = useState(false);
  const caseIdMatch = /^\/cases\/([^/]+)/.exec(location.pathname);
  const page =
    PAGE_LABELS[location.pathname] ??
    (location.pathname.endsWith('/verification')
      ? 'Verification timeline'
      : caseIdMatch
        ? caseIdMatch[1]!
        : 'Not found');
  const statusQuery = useQuery({
    queryKey: demoStatusQueryKey(identity.id),
    queryFn: ({ signal }) => getDemoStatus(identity.id, signal),
  });
  const healthQuery = useQuery({
    queryKey: dataHealthQueryKey(identity.id),
    queryFn: ({ signal }) => getDataHealth(identity.id, signal),
  });
  const status = statusQuery.data?.data;
  const health = healthQuery.data?.data;
  const razorpay = health?.sources.find((source) => source.source_system === 'RAZORPAY_TEST');
  const razorpayConnected = razorpay?.capability === 'available';
  const infrastructureDegraded = health
    ? health.database !== 'up' || health.worker !== 'up'
    : false;
  const optionalSourceUnavailable = health ? !razorpayConnected : false;
  const degraded = infrastructureDegraded || optionalSourceUnavailable;
  const resetInProgress = status ? !status.ready : false;
  const refreshing = statusQuery.isFetching || healthQuery.isFetching || isSwitching;
  useEffect(() => {
    setDegradedDismissed(false);
  }, [healthQuery.dataUpdatedAt]);
  useEffect(() => {
    const openScenarios = (): void => setScenarioOpen(true);
    window.addEventListener('moneytrace:open-scenarios', openScenarios);
    return () => window.removeEventListener('moneytrace:open-scenarios', openScenarios);
  }, []);
  const firstError = useMemo(() => {
    const error = statusQuery.error ?? healthQuery.error;
    return error ? asApiError(error) : null;
  }, [healthQuery.error, statusQuery.error]);
  const refresh = (): void => {
    void queryClient.refetchQueries({ type: 'active' }).then(() => announce('Page refreshed'));
  };
  const copyManifest = (): void => {
    if (!status?.manifest_hash) return;
    void navigator.clipboard.writeText(status.manifest_hash).then(
      () => announce('Manifest hash copied'),
      () => announce('Manifest hash could not be copied'),
    );
  };
  const retryReads = (): void => {
    void Promise.allSettled([statusQuery.refetch(), healthQuery.refetch()]);
  };
  return (
    <Tooltip.Provider>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="app-shell">
        <PrimaryNavigation
          degraded={degraded}
          seedId={status?.seed_id}
          expanded={navigationOpen}
          onExpand={() => {
            setNavigationReturnLabel('Expand navigation');
            setNavigationOpen(true);
          }}
        />
        <div className="app-frame">
          <ApplicationHeader
            page={page}
            fixedClock={status?.fixed_clock}
            manifestHash={status?.manifest_hash}
            connected={razorpayConnected}
            refreshing={refreshing}
            navigationOpen={navigationOpen}
            datasetOpen={datasetOpen}
            scenarioOpen={scenarioOpen}
            onOpenNavigation={() => {
              setNavigationReturnLabel('Open navigation');
              setNavigationOpen(true);
            }}
            onOpenDataset={() => setDatasetOpen(true)}
            onRefresh={refresh}
            onCopy={copyManifest}
            onShowScenarios={() => setScenarioOpen(true)}
          />
          <div className="banner-stack">
            {firstError && errorBanner(firstError, retryReads)}
            {!firstError && resetInProgress && (
              <GlobalStatusBanner
                tone="reset"
                title="Demo reset in progress. Financial mutations are temporarily unavailable."
              >
                Approve, simulate and reconcile are disabled. Read, audit and export continue.
              </GlobalStatusBanner>
            )}
            {!firstError && !resetInProgress && infrastructureDegraded && (
              <GlobalStatusBanner
                tone="degraded"
                title="Demo infrastructure degraded"
                action={
                  <NavLink className="banner-link" to="/data-health">
                    View Data Health <ArrowRight aria-hidden="true" size={14} />
                  </NavLink>
                }
              >
                Financial mutations may be unavailable. Existing verified evidence remains visible.
              </GlobalStatusBanner>
            )}
            {!firstError &&
              !resetInProgress &&
              !infrastructureDegraded &&
              optionalSourceUnavailable &&
              !degradedDismissed && (
                <GlobalStatusBanner
                  tone="degraded"
                  title="Optional Razorpay Test source unavailable"
                  action={
                    <NavLink className="banner-link" to="/data-health">
                      View Data Health
                    </NavLink>
                  }
                  dismissLabel="Dismiss degraded-source notice"
                  onDismiss={() => setDegradedDismissed(true)}
                >
                  Synthetic bank and Route evidence remain available; deterministic demo conclusions
                  are safe.
                </GlobalStatusBanner>
              )}
          </div>
          <main id="main-content" className="main-content" tabIndex={-1}>
            {isSwitching ? <SwitchingPlaceholder /> : <Outlet />}
          </main>
        </div>
      </div>
      <NavigationDrawer
        open={navigationOpen}
        onOpenChange={setNavigationOpen}
        degraded={degraded}
        returnFocusLabel={navigationReturnLabel}
      />
      <DatasetControlsSheet
        open={datasetOpen}
        onOpenChange={setDatasetOpen}
        fixedClock={status?.fixed_clock}
        manifestHash={status?.manifest_hash}
        connected={razorpayConnected}
        refreshing={refreshing}
        showScenarios={identity.id === 'user_operator'}
        onCopy={copyManifest}
        onRefresh={refresh}
        onShowScenarios={() => setScenarioOpen(true)}
      />
      <ScenarioStatusDrawer
        open={scenarioOpen}
        onOpenChange={setScenarioOpen}
        scenarios={status?.scenarios ?? []}
        fixedClock={status?.fixed_clock}
      />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </Tooltip.Provider>
  );
}
