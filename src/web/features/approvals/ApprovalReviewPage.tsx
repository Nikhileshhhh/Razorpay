import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useIdentity } from '../../app/identity.js';
import { recordDecision } from '../../data/mocks/approval-state.js';
import {
  APPROVAL_TABS,
  approvalsByState,
  approvalTabCounts,
  MOCK_APPROVALS,
  type ApprovalDetail,
  type ApprovalRowVM,
  type EvidenceCoverageVM,
  type HashPair,
} from '../../data/mocks/approvals.js';
import { formatMoney } from '../../formatting/money.js';

type ApprovalState = ApprovalRowVM['state'];
type Decision = 'approve' | 'reject' | 'request';
type DialogStage = null | 'confirm' | 'reject' | 'request' | 'inflight' | 'success';

const REASON_MIN = 10;
const REASON_MAX = 500;

/* -------------------------------------------------------------------------- */
/*  Glyphs — inline SVGs matching the design exactly                          */
/* -------------------------------------------------------------------------- */

function CircleGlyph({ size = 10 }: { readonly size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function CheckCircleGlyph({ size = 10 }: { readonly size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="6" fill="currentColor" />
      <path
        d="M3.4 6.2 5.2 8l3.4-3.6"
        stroke="#fff"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockGlyph({ size = 10 }: { readonly size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 5v3.2l2.2 1.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function TriangleGlyph({ size = 10 }: { readonly size?: number }): ReactElement {
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
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.6 11.4 11.4 4.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function FlaskGlyph({ size = 14 }: { readonly size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.2 2h3.6M6.9 2v3.6L4.1 11.6A1.6 1.6 0 0 0 5.5 14h5a1.6 1.6 0 0 0 1.4-2.4L9.1 5.6V2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WarnTriangleGlyph({ size = 14 }: { readonly size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.6 14.5 13.4H1.5L8 2.6Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 6.4v3.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.3" r=".85" fill="currentColor" />
    </svg>
  );
}

function CopyGlyph(): ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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

/* -------------------------------------------------------------------------- */
/*  Small shared pieces                                                        */
/* -------------------------------------------------------------------------- */

function moneyAria(printed: string): string {
  return `${printed} Indian rupees`;
}

function AmountValue({
  money,
  className,
}: {
  readonly money: ApprovalRowVM['amountImpact'];
  readonly className: string;
}): ReactElement {
  const printed = formatMoney(money).replace(' INR', '');
  return (
    <span className={className} aria-label={`${moneyAria(printed)}, maximum`}>
      {printed} <span className="apr-money-unit">INR</span>
    </span>
  );
}

function StateBadge({ state }: { readonly state: ApprovalState }): ReactElement {
  const glyph =
    state === 'APPROVED' ? (
      <CheckCircleGlyph />
    ) : state === 'REQUESTED' ? (
      <CircleGlyph />
    ) : state === 'EXPIRED' ? (
      <ClockGlyph />
    ) : (
      <XCircleGlyph />
    );
  const tone =
    state === 'REQUESTED'
      ? 'info'
      : state === 'APPROVED'
        ? 'success'
        : state === 'REJECTED'
          ? 'danger'
          : 'neutral';
  return (
    <span className={`apr-state apr-state--${tone}`}>
      {glyph}
      {state}
    </span>
  );
}

function ExpiryIndicator({ row }: { readonly row: ApprovalRowVM }): ReactElement {
  if (!row.expiresLocal) {
    return <span className="apr-expiry-plain">{row.expiryNote}</span>;
  }
  const withIcon = row.expiryTone === 'warning' || row.expiryTone === 'danger';
  return (
    <span className="apr-expiry">
      <abbr title={row.expiresUtcTitle ?? undefined} className="apr-expiry-time">
        {row.expiresLocal}
      </abbr>
      <span className={`apr-expiry-chip apr-expiry-chip--${row.expiryTone}`}>
        {withIcon && (row.expiryTone === 'danger' ? <TriangleGlyph /> : <ClockGlyph />)}
        {row.expiryNote}
      </span>
    </span>
  );
}

function HashField({
  hash,
  label,
  reveal = false,
}: {
  readonly hash: HashPair;
  readonly label: string;
  readonly reveal?: boolean;
}): ReactElement {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(hash.full).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      },
      () => undefined,
    );
  };
  return (
    <span className="apr-hash">
      <span className="apr-hash-value" aria-label={`${label} ${hash.full}`}>
        {revealed ? hash.full : hash.short}
      </span>
      <button
        type="button"
        className="apr-copy"
        aria-label={`Copy full ${label}`}
        title={`Copy full ${label}`}
        onClick={copy}
      >
        <CopyGlyph />
      </button>
      {reveal && (
        <button
          type="button"
          className="apr-reveal"
          aria-expanded={revealed}
          onClick={() => setRevealed((open) => !open)}
        >
          {revealed ? 'Hide' : 'Reveal'}
        </button>
      )}
      {reveal && <span className="apr-hash-note">read-only</span>}
      {copied && (
        <span className="apr-hash-note apr-hash-note--copied" role="status">
          copied
        </span>
      )}
    </span>
  );
}

function CoverageMeter({ coverage }: { readonly coverage: EvidenceCoverageVM }): ReactElement {
  return (
    <span className="apr-coverage">
      {coverage.label}
      <span
        className="apr-coverage-bars"
        role="img"
        aria-label={`${coverage.done} of ${coverage.total} evidence steps`}
      >
        {Array.from({ length: coverage.total }, (_, i) => (
          <span key={i} className={i < coverage.done ? 'is-done' : ''} />
        ))}
      </span>
      <span className="apr-coverage-count">
        {coverage.done} / {coverage.total}
      </span>
    </span>
  );
}

function BasisGroup({
  title,
  tag,
  tone = 'neutral',
  children,
}: {
  readonly title: string;
  readonly tag?: string;
  readonly tone?: 'neutral' | 'plan' | 'financial' | 'policy' | 'authorization';
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className={`apr-group apr-group--${tone}`}>
      <div className="apr-group-head">
        <span className="apr-group-title">{title}</span>
        {tag && <span className="apr-group-tag">{tag}</span>}
      </div>
      <div className="apr-group-body">{children}</div>
    </section>
  );
}

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <>
      <span className="apr-row-label">{label}</span>
      <span className="apr-row-value">{children}</span>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Decision dialogs                                                           */
/* -------------------------------------------------------------------------- */

function ConfirmDialog({
  row,
  detail,
  onConfirm,
  onCancel,
}: {
  readonly row: ApprovalRowVM;
  readonly detail: ApprovalDetail;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactElement {
  return (
    <div
      className="apr-dialog-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="apr-confirm-title"
      aria-describedby="apr-confirm-desc"
    >
      <div className="apr-dialog-head">
        <h3 id="apr-confirm-title">Approve simulated remediation for {row.caseId}?</h3>
        <p id="apr-confirm-desc">
          This records a HUMAN APPROVAL artifact against the immutable basis below. Confirm every
          field before approving.
        </p>
      </div>
      <div className="apr-dialog-grid">
        <Row label="Exact action">
          <span className="apr-mono apr-strong">{row.action}</span>
        </Row>
        <Row label="Target">
          <span className="apr-mono">{detail.targetSynthetic} (synthetic)</span>
        </Row>
        <Row label="Maximum INR impact">
          <AmountValue money={row.amountImpact} className="apr-money apr-money--md" />
        </Row>
        <Row label="Case version">
          <span className="apr-mono">{detail.boundCaseVersion}</span>
        </Row>
        <Row label="Plan version">
          <span className="apr-mono">
            {detail.planId} {detail.planVersion} · {detail.planHash.short}
          </span>
        </Row>
        <Row label="Evidence-set hash">
          <span className="apr-mono">{detail.evidenceHash.short}</span>
        </Row>
        <Row label="Decision-basis hash">
          <span className="apr-mono">{detail.basisHash.short}</span>
        </Row>
        <Row label="Expiry">
          {row.expiresLocal ?? '—'}{' '}
          {detail.expiryUtcFull && (
            <span className="apr-mono apr-dim apr-tiny">({detail.expiryUtcFull})</span>
          )}
        </Row>
      </div>
      <div className="apr-synthetic-note apr-synthetic-note--dialog">
        <FlaskGlyph size={15} />
        <span>Synthetic action — no real money movement.</span>
      </div>
      <div className="apr-dialog-actions">
        <button type="button" className="apr-btn apr-btn--primary" onClick={onConfirm}>
          Approve simulated remediation
        </button>
        <button type="button" className="apr-btn apr-btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <span className="apr-dialog-hint">focus trapped · Escape cancels</span>
      </div>
    </div>
  );
}

function ReasonDialog({
  decision,
  row,
  detail,
  onSubmit,
  onCancel,
}: {
  readonly decision: 'reject' | 'request';
  readonly row: ApprovalRowVM;
  readonly detail: ApprovalDetail;
  readonly onSubmit: (reason: string) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const trimmed = reason.trim();
  const invalid = trimmed.length < REASON_MIN;
  const showError = submitted && invalid;
  const printed = formatMoney(row.amountImpact);
  const isReject = decision === 'reject';

  const submit = (): void => {
    setSubmitted(true);
    if (!invalid) onSubmit(trimmed);
  };

  return (
    <div
      className="apr-dialog-card apr-dialog-card--pad"
      role="dialog"
      aria-modal="true"
      aria-labelledby="apr-reason-title"
    >
      <h3 id="apr-reason-title" className="apr-reason-title">
        {isReject
          ? `Reject remediation for ${row.approvalId}?`
          : `Request more evidence for ${row.approvalId}`}
      </h3>
      {isReject ? (
        <p className="apr-reason-lede">
          Rejection is recorded against decision-basis hash{' '}
          <span className="apr-mono apr-strong">{detail.basisHash.short}</span> for{' '}
          <span className="apr-mono apr-strong">
            {row.action} → {detail.targetSynthetic}
          </span>
          , maximum {printed}.
        </p>
      ) : (
        <p className="apr-reason-lede">
          The approval stays REQUESTED. Coverage is {detail.coverage.label} ({detail.coverage.done}{' '}
          of {detail.coverage.total}); the recorded blockers are independent bank credit evidence
          and ERP closure.
        </p>
      )}

      {showError && (
        <div className="apr-error-summary" role="alert">
          <strong>There is 1 problem with this form</strong>
          <a href="#apr-reason-input">
            Reason for {isReject ? 'rejection' : 'evidence'} is required
          </a>
        </div>
      )}

      <label className="apr-reason-field">
        <span className="apr-reason-label">
          {isReject ? 'Reason for rejection' : 'What evidence is needed, and from where'}{' '}
          <span className="apr-req">(required)</span>
        </span>
        <textarea
          id="apr-reason-input"
          className={showError ? 'is-invalid' : ''}
          value={reason}
          maxLength={REASON_MAX}
          rows={3}
          aria-invalid={showError}
          placeholder={
            isReject
              ? 'Explain why this basis is not approvable.'
              : 'e.g. Bank statement extract covering 22–24 Aug for the destination account, to confirm or rule out an independent credit.'
          }
          onChange={(event) => setReason(event.target.value)}
        />
        <span className="apr-reason-meta">
          <span className={showError ? 'apr-req' : ''}>
            {showError
              ? `Enter between ${REASON_MIN} and ${REASON_MAX} characters`
              : `${REASON_MIN}–${REASON_MAX} characters`}
          </span>
          <span className="apr-reason-count">
            {reason.length} / {REASON_MAX}
          </span>
        </span>
      </label>

      <div className="apr-dialog-actions">
        <button
          type="button"
          className={`apr-btn ${isReject ? 'apr-btn--danger' : 'apr-btn--primary'}`}
          onClick={submit}
        >
          {isReject ? 'Reject remediation' : 'Request more evidence'}
        </button>
        <button type="button" className="apr-btn apr-btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        {isReject && <span className="apr-dialog-hint">error summary links to the field</span>}
      </div>
    </div>
  );
}

function InFlightDialog({ decision }: { readonly decision: Decision }): ReactElement {
  const verb =
    decision === 'approve' ? 'approval' : decision === 'reject' ? 'rejection' : 'request';
  return (
    <div className="apr-dialog-card apr-dialog-card--pad" aria-busy="true">
      <div className="apr-dialog-actions apr-dialog-actions--flat">
        <span className="apr-btn apr-btn--disabled" aria-disabled="true">
          <span className="apr-spinner" aria-hidden="true" />
          Recording {verb}…
        </span>
        <span className="apr-btn apr-btn--ghost-disabled" aria-disabled="true">
          Cancel
        </span>
      </div>
      <p className="apr-inflight-note">
        Both buttons disabled for the duration. The queue row still reads REQUESTED — state changes
        only after the authoritative response. The dialog stays open until then, so no one sees a
        decision that has not been recorded.
      </p>
      <div className="apr-inflight-endpoint" role="status" aria-live="polite">
        POST /v1/cases/CASE-2077/approvals/APR-4471/
        {decision === 'request' ? 'request-more-evidence' : decision} · idem_2077_v4_01
      </div>
    </div>
  );
}

function SuccessDialog({
  decision,
  row,
  detail,
  onOpenCase,
  onBack,
}: {
  readonly decision: Decision;
  readonly row: ApprovalRowVM;
  readonly detail: ApprovalDetail;
  readonly onOpenCase: () => void;
  readonly onBack: () => void;
}): ReactElement {
  const headline =
    decision === 'approve'
      ? `${row.approvalId} approved · HUMAN APPROVAL recorded`
      : decision === 'reject'
        ? `${row.approvalId} rejected · decision recorded`
        : `${row.approvalId} — evidence requested · stays REQUESTED`;
  return (
    <div className="apr-success" role="status" aria-live="polite">
      <div className="apr-success-head">
        <CheckCircleGlyph size={15} />
        <span>{headline}</span>
      </div>
      <div className="apr-dialog-grid apr-dialog-grid--success">
        <Row label="Approver (server)">
          {detail.approverName ?? 'S. Menon'}{' '}
          <span className="apr-mono apr-dim">{detail.approverId ?? 'user_approver'}</span>
        </Row>
        <Row label="Decided at (server)">
          {detail.decidedAtLocal ?? '25 Aug 2026, 11:04:18 IST'}{' '}
          <span className="apr-mono apr-dim apr-tiny">
            ({detail.decidedAtUtc ?? '05:34:18 UTC'})
          </span>
        </Row>
        <Row label="Effect">
          <span className="apr-effect">
            {decision === 'approve'
              ? 'Simulated action authorised — no money has moved'
              : decision === 'reject'
                ? 'Remediation rejected — no money has moved'
                : 'Evidence requested — no money has moved'}
          </span>
        </Row>
      </div>
      <div className="apr-success-actions">
        <button type="button" className="apr-btn apr-btn--primary apr-btn--sm" onClick={onOpenCase}>
          Open case
        </button>
        <button type="button" className="apr-btn apr-btn--ghost apr-btn--sm" onClick={onBack}>
          Back to approvals
        </button>
        <span className="apr-dialog-hint">
          announced politely · queue refetched · focus moved here
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Review drawer                                                              */
/* -------------------------------------------------------------------------- */

function ReviewDrawer({
  row,
  onClose,
  onDecided,
}: {
  readonly row: ApprovalRowVM;
  readonly onClose: () => void;
  readonly onDecided: () => void;
}): ReactElement {
  const { identity } = useIdentity();
  const detail = row.detail;
  const [stage, setStage] = useState<DialogStage>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  // Only a Finance Approver may decide; the requester (an investigator) never can.
  const canDecide = identity.id === 'user_approver' && identity.id !== row.requesterId;
  const decidable = row.state === 'REQUESTED';
  const terminal = row.state === 'EXPIRED' || row.state === 'INVALIDATED';
  const decided = row.state === 'APPROVED' || row.state === 'REJECTED';

  useEffect(() => {
    if (stage !== 'inflight' || !decision) return;
    const timer = window.setTimeout(() => {
      recordDecision(row.approvalId, {
        decision,
        reason: reason || undefined,
        decidedById: identity.id,
        decidedByName: identity.label,
      });
      onDecided();
      setStage('success');
    }, 900);
    return () => window.clearTimeout(timer);
  }, [stage, decision, reason, row.approvalId, identity.id, identity.label, onDecided]);

  const start = (next: Decision): void => {
    setDecision(next);
    setStage(next === 'approve' ? 'confirm' : next);
  };
  const printed = formatMoney(row.amountImpact).replace(' INR', '');

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="apr-drawer" aria-describedby="apr-drawer-warn">
          {/* Header */}
          <div className="apr-drawer-head">
            <div className="apr-drawer-head-row">
              <div className="apr-drawer-ident">
                <div className="apr-drawer-title-row">
                  <Dialog.Title asChild>
                    <h2>{row.approvalId}</h2>
                  </Dialog.Title>
                  <StateBadge state={row.state} />
                </div>
                <div className="apr-drawer-sub">
                  <Link to={`/cases/${row.caseId}`}>{row.caseId} ›</Link>
                  <span>{detail.caseSubtitle}</span>
                </div>
              </div>
              <div className="apr-drawer-amount">
                <div className="apr-drawer-amount-label">MAX AMOUNT IMPACT</div>
                <div
                  className="apr-money apr-money--lg"
                  aria-label={`Maximum amount impact ${moneyAria(printed)}`}
                >
                  {printed} <span className="apr-money-unit">INR</span>
                </div>
                {row.expiresLocal &&
                  row.expiryTone !== 'neutral' &&
                  row.expiryTone !== 'expired' && (
                    <div className={`apr-expiry-chip apr-expiry-chip--${row.expiryTone}`}>
                      {row.expiryTone === 'danger' ? <TriangleGlyph /> : <ClockGlyph />}
                      {row.expiryNote}
                    </div>
                  )}
              </div>
              <Dialog.Close asChild>
                <button type="button" className="apr-close" aria-label="Close approval review">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M4 4l8 8M12 4l-8 8"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </Dialog.Close>
            </div>
            <div id="apr-drawer-warn" className="apr-synthetic-note apr-synthetic-note--drawer">
              <FlaskGlyph size={15} />
              <span>
                No real money movement. Approving records a decision for a synthetic action against
                the demo dataset only.
              </span>
            </div>
          </div>

          {/* Scrolling basis */}
          <div className="apr-drawer-scroll">
            <div className="apr-artifact-chips">
              <span className="apr-chip apr-chip--plan">
                <span className="apr-chip-glyph apr-chip-glyph--sq" aria-hidden="true" />
                REGISTERED PLAN
              </span>
              <span className="apr-chip apr-chip--policy">
                <span className="apr-chip-glyph apr-chip-glyph--tri" aria-hidden="true" />
                POLICY DECISION
              </span>
              <span className="apr-chip apr-chip--human">
                <CheckCircleGlyph size={9} />
                HUMAN APPROVAL
              </span>
              <span className="apr-chip apr-chip--sim">
                <span className="apr-chip-glyph apr-chip-glyph--dash" aria-hidden="true" />
                SIMULATED ACTION
              </span>
            </div>

            {detail.coverageWarning && (
              <div className="apr-coverage-warning">
                <WarnTriangleGlyph />
                <span>
                  <b>
                    Evidence coverage is {detail.coverage.label} ({detail.coverage.done} of{' '}
                    {detail.coverage.total}).
                  </b>{' '}
                  {detail.coverageWarning.replace(
                    `Evidence coverage is ${detail.coverage.label} (${detail.coverage.done} of ${detail.coverage.total}). `,
                    '',
                  )}
                </span>
              </div>
            )}

            {terminal && detail.terminationReason && (
              <div className="apr-termination">
                <div className="apr-termination-title">Termination reason</div>
                <p>{detail.terminationReason}</p>
              </div>
            )}

            <BasisGroup title="GROUP 1 · CASE BASIS">
              <Row label="Case ID">
                <Link className="apr-mono apr-strong" to={`/cases/${row.caseId}`}>
                  {row.caseId}
                </Link>
              </Row>
              <Row label="Bound case version">
                <span className="apr-mono">
                  {detail.boundCaseVersion}{' '}
                  <span className="apr-dim">· basis is bound to this version</span>
                </span>
              </Row>
              <Row label="Control / divergence">{detail.controlDivergence}</Row>
            </BasisGroup>

            <BasisGroup title="GROUP 2 · REGISTERED PLAN" tag="IMMUTABLE" tone="plan">
              <Row label="Plan ID">
                <span className="apr-mono apr-strong">{detail.planId}</span>
              </Row>
              <Row label="Plan version">
                <span className="apr-mono apr-strong">{detail.planVersion}</span>
              </Row>
              <Row label="Template / action">{detail.templateAction}</Row>
              <Row label="Plan hash">
                <HashField hash={detail.planHash} label="plan hash" reveal />
              </Row>
              <Row label="Parameters (verbatim)">
                <span className="apr-mono apr-params">{detail.parameters}</span>
              </Row>
              <Row label="Target">
                <span className="apr-mono apr-strong">
                  {detail.targetSynthetic} <span className="apr-dim">(synthetic)</span>
                </span>
              </Row>
            </BasisGroup>

            <BasisGroup
              title="GROUP 3 · FINANCIAL IMPACT"
              tag="MAXIMUM, NOT ESTIMATED"
              tone="financial"
            >
              <Row label="Exact simulated action">
                <span className="apr-mono apr-strong">{row.action}</span>
              </Row>
              <Row label="Target">
                <span className="apr-mono">{detail.targetSynthetic}</span>
              </Row>
              <Row label="Maximum amount impact">
                <AmountValue money={row.amountImpact} className="apr-money apr-money--md" />
              </Row>
              <Row label="Source value">
                <span className="apr-mono apr-tiny">
                  amount_minor &quot;{row.amountImpact.amount_minor}&quot; · formatted with BigInt
                  only
                </span>
              </Row>
            </BasisGroup>

            <BasisGroup title="GROUP 4 · EVIDENCE AND BLOCKERS">
              <Row label="Sealed evidence set">
                <span className="apr-hash-wrap">
                  <HashField hash={detail.evidenceHash} label="evidence-set hash" />
                  <span className="apr-hash-note">sealed at request time</span>
                </span>
              </Row>
              <Row label="Evidence coverage">
                <CoverageMeter coverage={detail.coverage} />
              </Row>
              <Row label="Contradictions">
                <span className="apr-contradictions">
                  <CircleGlyph size={11} />
                  {detail.contradictions} ·{' '}
                  {detail.contradictions === 0 ? 'none recorded' : 'recorded'}
                </span>
              </Row>
              <Row label="Blockers">
                {detail.blockers ? (
                  <span className="apr-blockers">{detail.blockers}</span>
                ) : (
                  <span className="apr-dim">None recorded</span>
                )}
              </Row>
              <Row label="Inspect">
                <Link className="apr-inspect" to={`/cases/${row.caseId}`}>
                  Open case evidence in a new view ›
                  <span className="apr-inspect-note">
                    review context is preserved — the drawer stays open behind it
                  </span>
                </Link>
              </Row>
            </BasisGroup>

            <BasisGroup title="GROUP 5 · POLICY AND VERIFICATION CONTRACT" tone="policy">
              <Row label="Policy bundle version">
                <span className="apr-mono apr-strong">{detail.policyBundle}</span>
              </Row>
              <Row label="Policy decision">
                <span className="apr-mono apr-strong">
                  {detail.policyDecisionId} ·{' '}
                  <span className="apr-allow">{detail.policyOutcome}</span>
                </span>
              </Row>
              <Row label="Matched rules">{detail.matchedRules}</Row>
              <Row label="Verification contract">
                <span className="apr-mono apr-strong">{detail.verificationContract}</span>
              </Row>
            </BasisGroup>

            <BasisGroup title="GROUP 6 · AUTHORIZATION" tone="authorization">
              <Row label="Requester / preparer">
                {row.requesterName} <span className="apr-mono apr-dim">{row.requesterId}</span> ·{' '}
                {row.requestedDateLocal} {row.requestedTimeLocal}
              </Row>
              <Row label="Required approver role">
                <span className="apr-strong">{row.requiredRole} </span>
                {canDecide ? (
                  <span className="apr-match">— matches your demo role</span>
                ) : (
                  <span className="apr-mismatch">
                    — your demo role is {identity.label}; Finance Approver required
                  </span>
                )}
              </Row>
              <Row label="Expiry">
                {row.expiresLocal ?? (decided ? 'n/a — decided before expiry' : '—')}{' '}
                {detail.expiryUtcFull && (
                  <span className="apr-mono apr-dim apr-tiny">({detail.expiryUtcFull})</span>
                )}
              </Row>
              <Row label="Decision-basis hash">
                <HashField hash={detail.basisHash} label="decision-basis hash" />
              </Row>
              <Row label="Idempotency key">
                <span className="apr-mono apr-tiny">
                  {detail.idempotencyKey}{' '}
                  <span className="apr-dim">· read-only, never regenerated</span>
                </span>
              </Row>
              <Row label="Separation of duties">
                <span className="apr-sod">{detail.separationOfDuties}</span>
              </Row>
            </BasisGroup>

            {decided && (
              <div className="apr-decision-record">
                <div className="apr-decision-record-title">{detail.decisionText}</div>
                <div className="apr-dialog-grid apr-dialog-grid--success">
                  <Row label="Approver (server)">
                    {detail.approverName}{' '}
                    <span className="apr-mono apr-dim">{detail.approverId}</span>
                  </Row>
                  <Row label="Decided at (server)">
                    {detail.decidedAtLocal}{' '}
                    {detail.decidedAtUtc && (
                      <span className="apr-mono apr-dim apr-tiny">({detail.decidedAtUtc})</span>
                    )}
                  </Row>
                </div>
              </div>
            )}

            {terminal && (
              <div className="apr-historical">
                <div className="apr-dialog-grid apr-dialog-grid--success">
                  <Row label="Historical basis">{detail.historicalBasis}</Row>
                  <Row label="Amount impact">
                    <AmountValue money={row.amountImpact} className="apr-money apr-money--md" />
                  </Row>
                  <Row label="Decision">
                    <span className="apr-dim">{detail.decisionText}</span>
                  </Row>
                </div>
              </div>
            )}
          </div>

          {/* Action footer */}
          {decidable && canDecide ? (
            <div className="apr-drawer-foot">
              <div className="apr-drawer-actions">
                <button
                  type="button"
                  className="apr-btn apr-btn--primary"
                  onClick={() => start('approve')}
                >
                  Approve simulated remediation
                </button>
                <button
                  type="button"
                  className="apr-btn apr-btn--reject"
                  onClick={() => start('reject')}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="apr-btn apr-btn--ghost"
                  onClick={() => start('request')}
                >
                  Request more evidence
                </button>
              </div>
              <p className="apr-drawer-foot-note">
                Approve opens a final deliberate confirmation. Reject and Request more evidence each
                require a bounded reason. No generic Confirm exists anywhere in this flow.
              </p>
            </div>
          ) : decidable ? (
            <div className="apr-drawer-foot">
              <div className="apr-drawer-actions">
                <button type="button" className="apr-btn apr-btn--primary" disabled>
                  Approve simulated remediation
                </button>
                <button type="button" className="apr-btn apr-btn--reject" disabled>
                  Reject
                </button>
                <button type="button" className="apr-btn apr-btn--ghost" disabled>
                  Request more evidence
                </button>
              </div>
              <p className="apr-drawer-foot-note">
                Decision controls are limited to the <b>Finance Approver</b> role. Switch demo role
                to Finance Approver to approve, reject or request more evidence. Your current role
                can read the full decision basis.
              </p>
            </div>
          ) : (
            <div className="apr-drawer-foot apr-drawer-foot--history">
              <div className="apr-drawer-actions">
                <Link className="apr-btn apr-btn--ghost apr-btn--sm" to={`/cases/${row.caseId}`}>
                  Open case
                </Link>
                <Link
                  className="apr-btn apr-btn--ghost apr-btn--sm"
                  to={`/audit?case=${row.caseId}`}
                >
                  View audit replay
                </Link>
              </div>
              <p className="apr-drawer-foot-note">
                {row.state} is terminal — no decision control exists in this state. The basis is
                retained unchanged for audit.
              </p>
            </div>
          )}

          {/* Decision dialog overlay */}
          {stage && decision && (
            <div className="apr-dialog-scrim" role="presentation">
              {stage === 'confirm' && (
                <ConfirmDialog
                  row={row}
                  detail={detail}
                  onConfirm={() => setStage('inflight')}
                  onCancel={() => setStage(null)}
                />
              )}
              {(stage === 'reject' || stage === 'request') && (
                <ReasonDialog
                  decision={stage}
                  row={row}
                  detail={detail}
                  onSubmit={(submittedReason) => {
                    setReason(submittedReason);
                    setStage('inflight');
                  }}
                  onCancel={() => setStage(null)}
                />
              )}
              {stage === 'inflight' && <InFlightDialog decision={decision} />}
              {stage === 'success' && (
                <SuccessDialog
                  decision={decision}
                  row={row}
                  detail={{
                    ...detail,
                    approverName: identity.label,
                    approverId: identity.id,
                  }}
                  onOpenCase={onClose}
                  onBack={onClose}
                />
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* -------------------------------------------------------------------------- */
/*  Queue table                                                                */
/* -------------------------------------------------------------------------- */

function QueueTable({
  rows,
  onReview,
}: {
  readonly rows: readonly ApprovalRowVM[];
  readonly onReview: (row: ApprovalRowVM) => void;
}): ReactElement {
  return (
    <div className="apr-table-card">
      <div className="apr-table-scroll">
        <table className="apr-table">
          <caption className="sr-only">
            Requested approvals — {rows.length} records, sorted by expiry then material amount.
          </caption>
          <thead>
            <tr>
              <th scope="col">APPROVAL ID</th>
              <th scope="col">CASE ID</th>
              <th scope="col" className="apr-num">
                AMOUNT IMPACT
              </th>
              <th scope="col">EXACT SIMULATED ACTION</th>
              <th scope="col">REQUESTER</th>
              <th scope="col">REQUIRED ROLE</th>
              <th scope="col">REQUESTED AT</th>
              <th scope="col">EXPIRES</th>
              <th scope="col">STATE</th>
              <th scope="col" className="apr-num">
                REVIEW
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.approvalId}
                className={`${index % 2 === 1 ? '' : 'apr-row--tint'} ${index === 0 ? 'apr-row--active' : ''}`.trim()}
              >
                <td>
                  <button type="button" className="apr-id-link" onClick={() => onReview(row)}>
                    {row.approvalId}
                  </button>
                </td>
                <td>
                  <Link className="apr-case-link" to={`/cases/${row.caseId}`}>
                    {row.caseId}
                  </Link>
                </td>
                <td className="apr-num">
                  <span className="apr-amount">
                    {formatMoney(row.amountImpact).replace(' INR', '')}
                  </span>
                  <span className="apr-amount-unit">INR max</span>
                </td>
                <td>
                  <span className="apr-action">{row.action}</span>
                  <span className="apr-action-target">{row.target}</span>
                </td>
                <td>
                  <span className="apr-requester">{row.requesterName}</span>
                  <span className="apr-requester-id">{row.requesterId}</span>
                </td>
                <td className="apr-role">{row.requiredRole}</td>
                <td>
                  <abbr title={row.requestedUtcTitle} className="apr-requested">
                    {row.requestedDateLocal}
                    <br />
                    {row.requestedTimeLocal}
                  </abbr>
                </td>
                <td>
                  <ExpiryIndicator row={row} />
                </td>
                <td>
                  <div className="apr-state-cell">
                    <StateBadge state={row.state} />
                    {row.decisionNote && (
                      <span className="apr-decision-note">{row.decisionNote}</span>
                    )}
                  </div>
                </td>
                <td className="apr-num">
                  <button
                    type="button"
                    className={
                      row.state === 'REQUESTED'
                        ? 'apr-review-btn apr-review-btn--primary'
                        : 'apr-review-btn'
                    }
                    onClick={() => onReview(row)}
                  >
                    {row.state === 'REQUESTED' ? 'Review approval' : 'View basis'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="apr-table-foot">
        <span role="status" aria-live="polite">
          Showing <span className="apr-mono apr-strong">1–{rows.length}</span> of{' '}
          <span className="apr-mono apr-strong">{rows.length}</span>{' '}
          {rows.length === 1 ? 'record' : 'records'}
        </span>
        <span className="apr-table-foot-note">
          expiry ascending, then amount descending — server-sorted
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export function ApprovalReviewPage(): ReactElement {
  const [tab, setTab] = useState<ApprovalState>('REQUESTED');
  const [reviewing, setReviewing] = useState<ApprovalRowVM | null>(null);
  // Bumped after a decision so the table + tab counts recompute from the store.
  const [, bumpVersion] = useState(0);
  const rows = approvalsByState(tab);
  const tabCounts = approvalTabCounts();

  return (
    <div className="apr-page">
      <nav className="mobile-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/overview">Overview</Link>
        <span aria-hidden="true">/</span>
        <strong aria-current="page">Approvals</strong>
      </nav>

      <header className="apr-header">
        <div>
          <h1>Approvals</h1>
          <p>Review immutable decision bases for synthetic financial remediation.</p>
        </div>
        <span role="note" className="apr-safety-note">
          <FlaskGlyph size={14} />
          Synthetic demo only · Approval cannot move real money
          <span className="apr-safety-note-tag">not dismissable</span>
        </span>
      </header>

      <div role="tablist" aria-label="Approval state" className="apr-tabs">
        {APPROVAL_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`apr-tab ${tab === item.key ? 'apr-tab--active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
            <span className="apr-tab-count">{tabCounts[item.key]}</span>
          </button>
        ))}
        <span className="apr-tabs-note">
          counts from GET /v1/approvals · omitted entirely when the field is absent
        </span>
      </div>

      <div className="apr-filter-bar">
        <label className="apr-filter">
          <span className="apr-filter-label">APPROVAL OR CASE ID</span>
          <span className="apr-filter-control">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" stroke="#8b95a5" strokeWidth="1.4" />
              <path d="M10.4 10.4 14 14" stroke="#8b95a5" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span className="apr-filter-placeholder">APR-… or CASE-…</span>
          </span>
        </label>
        <label className="apr-filter">
          <span className="apr-filter-label">REQUIRED ROLE</span>
          <span className="apr-filter-control">
            <span className="apr-filter-value">Any allowlisted role</span>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M4 6.5 8 10.5l4-4"
                stroke="#8b95a5"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </label>
        <label className="apr-filter">
          <span className="apr-filter-label">ACTION TEMPLATE</span>
          <span className="apr-filter-control">
            <span className="apr-filter-value">All templates</span>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M4 6.5 8 10.5l4-4"
                stroke="#8b95a5"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </label>
        <label className="apr-filter">
          <span className="apr-filter-label">SORT</span>
          <span className="apr-filter-control">
            <span className="apr-filter-value apr-filter-value--strong">Expiry, then amount</span>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M4 6.5 8 10.5l4-4"
                stroke="#8b95a5"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </label>
        <span className="apr-filter-note">
          identifier lookup and allowlisted values only
          <br />
          no full-text search over approvals
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="apr-empty">
          <CircleGlyph size={18} />
          <div>
            <strong>No approvals in this state.</strong>
            <span>Switch tabs to see approved, rejected, expired or invalidated decisions.</span>
          </div>
        </div>
      ) : (
        <QueueTable rows={rows} onReview={setReviewing} />
      )}

      {reviewing && (
        <ReviewDrawer
          row={reviewing}
          onClose={() => setReviewing(null)}
          onDecided={() => bumpVersion((v) => v + 1)}
        />
      )}

      <p className="sr-only">
        {MOCK_APPROVALS.length} approvals loaded from the synthetic dataset.
      </p>
    </div>
  );
}
