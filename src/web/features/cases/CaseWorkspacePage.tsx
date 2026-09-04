import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  RotateCcw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useState, type ReactElement, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Money } from '../../../contracts/index.js';
import { useIdentity } from '../../app/identity.js';
import {
  COMPACT_WORKSPACES,
  PRIMARY_WORKSPACES,
  type CandidateRelationshipVM,
  type CommandVM,
  type CompactWorkspaceVM,
  type MoneyPathNodeVM,
  type OperatorNoteVM,
  type PrimaryWorkspaceVM,
} from '../../data/mocks/case-workspace.js';
import { buildGeneratedWorkspace } from '../../data/mocks/case-workspace-generator.js';
import { caseDisplay } from '../../data/mocks/cases.js';
import { caseQueueQueryKey, getCaseQueue } from '../../data/cases.js';
import { formatMoney } from '../../formatting/money.js';
import { LoadingState, NotFoundState } from '../shell/states/StatePanels.js';
import { VerificationTimeline } from './VerificationTimeline.js';

function money(value: Money): string {
  return formatMoney(value);
}

function Breadcrumb({ caseId }: { readonly caseId: string }): ReactElement {
  return (
    <>
      <nav className="mobile-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/overview">Overview</Link>
        <span aria-hidden="true">/</span>
        <Link to="/cases">Cases</Link>
        <span aria-hidden="true">/</span>
        <strong aria-current="page">{caseId}</strong>
      </nav>
      <div className="workspace-top-bar">
        <Link className="workspace-back-link" to="/cases">
          <ChevronRight aria-hidden="true" size={13} className="workspace-back-chevron" />
          Back to cases
        </Link>
        <nav className="workspace-crumb" aria-label="Breadcrumb">
          <Link to="/cases">Cases</Link>
          <span aria-hidden="true">/</span>
          <strong aria-current="page">{caseId}</strong>
        </nav>
        <span className="workspace-preserved-note">
          queue filters preserved · ?lifecycle=open,investigating&sort=exposure_desc
        </span>
      </div>
    </>
  );
}

function LaneNode({ node }: { readonly node: MoneyPathNodeVM }): ReactElement {
  const kindLabel: Record<MoneyPathNodeVM['kind'], string> = {
    expected: 'EXPECTED',
    source_fact: 'SOURCE FACT',
    derived: 'DERIVED CTL',
    simulated_action: 'SIMULATED ACTION',
    acknowledgement: 'ACKNOWLEDGEMENT',
    no_data: 'NO DATA',
  };
  return (
    <div className={`mp-node mp-node--${node.kind}`}>
      <div className="mp-node-kind">{kindLabel[node.kind]}</div>
      <div className="mp-node-label">{node.label}</div>
      <div className="mp-node-status">{node.status}</div>
      {node.amount && <div className="mp-node-amount">{money(node.amount)}</div>}
      {node.caption && <div className="mp-node-caption">{node.caption}</div>}
    </div>
  );
}

function MoneyPathSection({ workspace }: { readonly workspace: PrimaryWorkspaceVM }): ReactElement {
  return (
    <section aria-label="Expected versus observed money path" className="workspace-card">
      <div className="workspace-card-heading">
        <h2>Expected versus observed money path</h2>
        <span className="workspace-card-note">deterministic, not editable</span>
      </div>
      <div className="mp-lane-block">
        <div className="mp-lane-label">EXPECTED LANE · ALWAYS VISIBLE</div>
        <div className="mp-lane mp-lane--expected">
          {workspace.expectedLane.map((node) => (
            <LaneNode key={node.key} node={node} />
          ))}
        </div>
        <div className="mp-lane-label">OBSERVED LANE · PERSISTED NODES ONLY</div>
        <div className="mp-lane mp-lane--observed">
          {workspace.observedLane.map((node) => (
            <LaneNode key={node.key} node={node} />
          ))}
          <div className="mp-divergence">
            <AlertTriangle aria-hidden="true" size={16} />
            <strong>{workspace.divergence.label}</strong>
            <span>
              {workspace.divergence.detail} · {workspace.divergence.due}
            </span>
          </div>
        </div>
      </div>
      <div className="mp-legend">
        <span>
          <i className="mp-legend-key mp-legend-key--verified" /> verified / derived edge
        </span>
        <span>
          <i className="mp-legend-key mp-legend-key--expected" /> expected only — no observed edge
        </span>
        <span className="mp-legend-note">each edge cites its evidence</span>
      </div>
    </section>
  );
}

function OfflineInvestigationSection({
  workspace,
}: {
  readonly workspace: PrimaryWorkspaceVM;
}): ReactElement {
  const inv = workspace.investigation;
  return (
    <section
      aria-label="Offline demo investigation"
      className="workspace-card workspace-card--investigation"
    >
      <div className="investigation-heading">
        <span className="investigation-badge">OFFLINE DEMO INVESTIGATION</span>
        <h2>Deterministic offline analysis · no live model call</h2>
        <span className="investigation-safety">Not safe to act — approval required</span>
      </div>
      <div className="investigation-meta">
        <span>
          mode <b>{inv.mode}</b>
        </span>
        <span>
          prompt <b>{inv.promptVersion}</b>
        </span>
        <span>
          schema <b>{inv.schemaVersion}</b>
        </span>
        <span>
          evidence-set <b>{inv.evidenceSetHash}</b>
        </span>
        <span>
          created <b>{inv.createdLocal}</b>
        </span>
        <span>
          confidence band <b>{inv.confidenceBand}</b>
        </span>
        <span>
          coverage <b>{inv.coverageLabel}</b>
        </span>
        <span>
          contradictions <b>{inv.contradictions}</b>
        </span>
      </div>
      <ol className="investigation-grid">
        <li>
          <div className="investigation-item-head">
            <span>1</span>Finding
          </div>
          <p>{inv.finding}</p>
        </li>
        <li>
          <div className="investigation-item-head">
            <span>2</span>Supporting evidence used
          </div>
          <p>{inv.supportingEvidence}</p>
        </li>
        <li>
          <div className="investigation-item-head">
            <span>3</span>Contradicting and missing evidence
          </div>
          <p>{inv.missingEvidence}</p>
        </li>
        <li>
          <div className="investigation-item-head">
            <span>4</span>Recommended registered next step
          </div>
          <p>{inv.recommendation}</p>
        </li>
      </ol>
    </section>
  );
}

function EvidenceTimelineSection({
  workspace,
}: {
  readonly workspace: PrimaryWorkspaceVM;
}): ReactElement {
  return (
    <section aria-label="Evidence timeline" className="workspace-card">
      <div className="workspace-card-heading">
        <h2>Evidence timeline</h2>
        <span className="workspace-card-note">chronological · payloads redacted</span>
      </div>
      <div className="evidence-list">
        <div className="evidence-row evidence-row--head">
          <span>SOURCE</span>
          <span>CANONICAL / RAW TYPE</span>
          <span>EVENT TIME</span>
          <span className="et-amount">AMOUNT</span>
          <span>AUTHORITY</span>
        </div>
        {workspace.evidence.map((row) => (
          <div
            className={`evidence-row-wrap evidence-row-wrap--${row.authorityTone}`}
            key={row.reference}
          >
            <div className="evidence-row">
              <span>{row.source}</span>
              <span>
                {row.canonicalType} <small>raw: {row.rawType}</small>
              </span>
              <span>{row.eventTime}</span>
              <span className="et-amount">{row.amount ? money(row.amount) : '—'}</span>
              <span className={`evidence-authority evidence-authority--${row.authorityTone}`}>
                {row.authority}
              </span>
            </div>
            <div className="evidence-detail-line">
              {row.detail} <span className="evidence-reference">{row.reference} ›</span>
            </div>
            {row.flag && (
              <div className={`evidence-flag evidence-flag--${row.flag.tone}`}>{row.flag.text}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function CommandButton({ command }: { readonly command: CommandVM }): ReactElement {
  if (command.kind === 'locked') {
    return (
      <span className="rail-command rail-command--locked">
        {command.label}
        {command.note && <span className="rail-command-note">{command.note}</span>}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`rail-command ${command.kind === 'primary' ? 'rail-command--primary' : ''}`}
    >
      {command.label}
      {command.badge && <span className="rail-command-badge">{command.badge}</span>}
    </button>
  );
}

type CandidateDecision = 'confirm' | 'reject';

function CandidateReasonDialog({
  decision,
  linkVersion,
  caseVersion,
  onClose,
}: {
  readonly decision: CandidateDecision;
  readonly linkVersion: number;
  readonly caseVersion: number;
  readonly onClose: (recorded: boolean) => void;
}): ReactElement {
  const [reason, setReason] = useState('');
  const [stage, setStage] = useState<'editing' | 'conflict'>('editing');
  const title =
    decision === 'confirm' ? 'Confirm candidate relationship' : 'Reject candidate relationship';
  const submitLabel = decision === 'confirm' ? 'Record reviewed assertion' : 'Record rejection';

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content
          className="drawer-content candidate-dialog"
          aria-describedby="candidate-dialog-note"
        >
          <div className="drawer-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="icon-button"
                aria-label="Close dialog"
                onClick={() => onClose(false)}
              >
                <X aria-hidden="true" size={17} />
              </button>
            </Dialog.Close>
          </div>
          <p id="candidate-dialog-note" className="cq-mono-dim">
            expects link version {linkVersion} · case version {caseVersion} · evidence set 5c1a…d38b
          </p>
          {stage === 'editing' ? (
            <>
              <label className="approval-reason-field">
                <span>
                  Reason for {decision === 'confirm' ? 'confirmation' : 'rejection'} (required)
                </span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value.slice(0, 500))}
                  rows={4}
                  placeholder="Statement line matches amount and settlement window; reference difference explained by bank narration truncation."
                />
              </label>
              <div className="candidate-dialog-count">{reason.length} / 500</div>
              <div className="approval-confirm-actions">
                <button
                  type="button"
                  className={
                    decision === 'confirm'
                      ? 'primary-button'
                      : 'secondary-button secondary-button--danger'
                  }
                  disabled={reason.trim().length === 0}
                  onClick={() => setStage('conflict')}
                >
                  {submitLabel}
                </button>
                <button type="button" className="secondary-button" onClick={() => onClose(false)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="candidate-version-conflict" role="alert">
              <strong>VERSION_CONFLICT — this review is out of date</strong>
              <p>
                The candidate link moved to version {linkVersion + 1} while the dialog was open. The
                dialog has been closed, the panel refetched, and the change announced. Review the
                updated candidate and its evidence before confirming again — the previous reason
                text is not carried over.
              </p>
              <button type="button" className="secondary-button" onClick={() => onClose(false)}>
                Close
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CandidateRelationshipSection({
  candidate,
  caseVersion,
}: {
  readonly candidate: CandidateRelationshipVM;
  readonly caseVersion: number;
}): ReactElement {
  const [decision, setDecision] = useState<CandidateDecision | null>(null);
  return (
    <section aria-label="Candidate relationship review" className="workspace-card candidate-card">
      <div className="candidate-card-heading">
        <span className="candidate-badge">CANDIDATE RELATIONSHIP</span>
        <span className="cq-mono-dim">never rendered inside the money path lanes</span>
      </div>
      <dl className="candidate-fields">
        <div>
          <dt>Source node</dt>
          <dd>{candidate.sourceNode}</dd>
        </div>
        <div>
          <dt>Target node</dt>
          <dd>{candidate.targetNode}</dd>
        </div>
        <div>
          <dt>Relationship</dt>
          <dd>{candidate.relationship}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{candidate.confidence}</dd>
        </div>
        <div>
          <dt>Link version</dt>
          <dd>{candidate.linkVersion}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{candidate.evidence}</dd>
        </div>
      </dl>
      <p className="candidate-terminal-note">
        Confirmation records a reviewed assertion; it is not terminal financial authority.
        Verification still requires the independent evidence contract to pass.
      </p>
      <div className="candidate-actions">
        <button type="button" className="primary-button" onClick={() => setDecision('confirm')}>
          Confirm candidate relationship
        </button>
        <button
          type="button"
          className="secondary-button secondary-button--danger"
          onClick={() => setDecision('reject')}
        >
          Reject candidate relationship
        </button>
        <span className="cq-mono-dim">each opens a reason dialog</span>
      </div>
      {decision && (
        <CandidateReasonDialog
          decision={decision}
          linkVersion={candidate.linkVersion}
          caseVersion={caseVersion}
          onClose={() => setDecision(null)}
        />
      )}
    </section>
  );
}

function OperatorNotesSection({
  notes,
  caseVersion,
}: {
  readonly notes: readonly OperatorNoteVM[];
  readonly caseVersion: number;
}): ReactElement {
  const [allNotes, setAllNotes] = useState(notes);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { identity } = useIdentity();

  const submit = (): void => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setError('A note cannot be empty and cannot exceed 1,000 characters.');
      return;
    }
    setAllNotes((current) => [
      ...current,
      {
        author: identity.label,
        authorRole: identity.id,
        timestamp: 'just now',
        body: trimmed,
      },
    ]);
    setDraft('');
    setError(null);
  };

  return (
    <section aria-label="Operator notes" className="workspace-card notes-card">
      <div className="notes-heading">
        <h2>Operator notes</h2>
        <span className="notes-badge">NOT FINANCIAL EVIDENCE</span>
        <span className="cq-mono-dim">GET /v1/cases/:id/notes · plain text only</span>
      </div>
      <ul className="notes-list">
        {allNotes.map((note, index) => (
          <li key={index}>
            <div className="notes-author-row">
              <strong>{note.author}</strong>
              <span className="cq-mono-dim">
                {note.authorRole} · {note.timestamp}
              </span>
            </div>
            <p>{note.body}</p>
          </li>
        ))}
      </ul>
      <div className="notes-add">
        <div className="notes-add-heading">
          Add note · case version {caseVersion} · plain text, 1,000 characters
        </div>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, 1000))}
          rows={3}
          placeholder="Document review context. Notes cannot change financial state."
        />
        <div className="notes-add-footer">
          <button type="button" className="primary-button" onClick={submit}>
            Add operator note
          </button>
          <span className="cq-mono-dim">{draft.length} / 1000</span>
        </div>
        {error && <div className="notes-validation">Validation: {error}</div>}
      </div>
    </section>
  );
}

function ControlLoopRail({ workspace }: { readonly workspace: PrimaryWorkspaceVM }): ReactElement {
  return (
    <aside aria-label="Control loop" className="control-loop-rail">
      <div className="rail-heading">CONTROL LOOP · SIX ARTIFACTS</div>
      {workspace.rail.map((card) => (
        <div key={card.key} className={`rail-card rail-card--${card.tone}`}>
          <div className="rail-card-head">
            <span className="rail-card-title">{card.title}</span>
            <span className="rail-card-status">{card.status}</span>
          </div>
          {card.lines.map((line) => (
            <div className="rail-card-line" key={line}>
              {line}
            </div>
          ))}
          {card.note && <div className="rail-card-footnote">{card.note}</div>}
        </div>
      ))}
      <div className="rail-commands">
        <div className="rail-commands-heading">CONTEXTUAL COMMANDS</div>
        {workspace.commands.map((command) => (
          <CommandButton key={command.label} command={command} />
        ))}
      </div>
    </aside>
  );
}

function PrimaryWorkspace({ workspace }: { readonly workspace: PrimaryWorkspaceVM }): ReactElement {
  const { identity } = useIdentity();
  const [assignedToMe, setAssignedToMe] = useState(false);
  const owner = assignedToMe ? identity.label : workspace.owner;
  return (
    <div className="case-workspace-page">
      <Breadcrumb caseId={workspace.caseId} />
      <section aria-label="Case financial header" className="workspace-header">
        <div className="workspace-header-main">
          <div className="workspace-title-row">
            <h1>{workspace.caseId}</h1>
            <span className="workspace-control-tag">
              {workspace.controlId} · {workspace.controlLabel}
            </span>
            <span className="workspace-epoch">
              epoch {workspace.epoch} · seq {workspace.seq} · case version {workspace.caseVersion}
            </span>
          </div>
          <p className="workspace-headline">{workspace.headline}</p>
          <div className="workspace-badge-row">
            <span className="wb wb--materiality">{workspace.materiality}</span>
            <span className="wb wb--lifecycle">Lifecycle · {workspace.lifecycleLabel}</span>
            <span className={`wb wb--outcome wb--outcome-${workspace.outcomeTone}`}>
              Outcome · {workspace.outcomeLabel}
            </span>
            <span className="wb-divider" aria-hidden="true" />
            <span className="wb wb--neutral">Evidence coverage · {workspace.evidenceCoverage}</span>
            <span className="wb wb--neutral">Contradictions · {workspace.contradictions}</span>
          </div>
        </div>
        <div className="workspace-header-side">
          <div>
            <div className="whs-label">EXPOSURE</div>
            <div className="whs-exposure">
              {money(workspace.exposure)} <span>INR at risk</span>
            </div>
          </div>
          <div className="whs-grid">
            <span>
              <b>OPENED</b>
              <abbr title={workspace.openedUtcTitle}>{workspace.openedLocal}</abbr>
            </span>
            <span>
              <b>AGE</b>
              {workspace.age}
            </span>
            <span>
              <b>DUE</b>
              <abbr title={workspace.dueUtcTitle} className="whs-due">
                {workspace.dueLocal}
              </abbr>
            </span>
            <span>
              <b>OWNER</b>
              <span className="whs-owner-row">
                {owner ?? 'Unassigned'}
                {!owner && (
                  <button
                    type="button"
                    className="whs-assign-button"
                    onClick={() => setAssignedToMe(true)}
                  >
                    Assign to me
                  </button>
                )}
              </span>
            </span>
          </div>
          <div className="whs-assign-note">
            assignment submits expected case version {workspace.caseVersion} · stale version →
            refetch &amp; re-confirm
          </div>
        </div>
        <div className="workspace-safe-action">
          <span>CURRENT SAFE ACTION</span>
          <span>{workspace.currentSafeAction}</span>
        </div>
      </section>

      <div className="workspace-columns">
        <div className="workspace-main-column">
          <MoneyPathSection workspace={workspace} />
          <OfflineInvestigationSection workspace={workspace} />
          <EvidenceTimelineSection workspace={workspace} />
          <div className="workspace-card">
            <div className="workspace-card-heading">
              <h2>Verification timeline</h2>
              <Link className="overview-text-link" to={`/cases/${workspace.caseId}/verification`}>
                Open full timeline <ArrowRight aria-hidden="true" size={13} />
              </Link>
            </div>
            <VerificationTimeline caseId={workspace.caseId} />
          </div>
          {workspace.candidateRelationship && (
            <CandidateRelationshipSection
              candidate={workspace.candidateRelationship}
              caseVersion={workspace.caseVersion}
            />
          )}
          <OperatorNotesSection
            notes={workspace.operatorNotes}
            caseVersion={workspace.caseVersion}
          />
        </div>
        <ControlLoopRail workspace={workspace} />
      </div>
    </div>
  );
}

const BANNER_ICON: Record<CompactWorkspaceVM['banner']['tone'], ReactNode> = {
  success: <Check aria-hidden="true" size={17} />,
  warning: <AlertTriangle aria-hidden="true" size={17} />,
  danger: <ShieldAlert aria-hidden="true" size={17} />,
  slate: <RotateCcw aria-hidden="true" size={17} />,
};

function CompactLaneNode({ node }: { readonly node: MoneyPathNodeVM }): ReactElement {
  return <LaneNode node={node} />;
}

function CompactWorkspace({ workspace }: { readonly workspace: CompactWorkspaceVM }): ReactElement {
  return (
    <div className="case-workspace-page case-workspace-page--compact">
      <Breadcrumb caseId={workspace.caseId} />
      <div className="compact-header">
        <span className="compact-case-id">{workspace.caseId}</span>
        <span className="wb wb--lifecycle">Lifecycle · {workspace.lifecycleLabel}</span>
        <span className={`wb wb--outcome wb--outcome-${workspace.outcomeTone}`}>
          Outcome · {workspace.outcomeLabel}
        </span>
        {workspace.headerNote && <span className="wb wb--neutral">{workspace.headerNote}</span>}
        <div className="compact-metrics">
          {workspace.metrics.map((metric) => (
            <span key={metric.label}>
              <b>{metric.label}</b>
              {metric.value}
            </span>
          ))}
        </div>
      </div>
      <div className={`compact-banner compact-banner--${workspace.banner.tone}`} role="status">
        {BANNER_ICON[workspace.banner.tone]}
        <div>
          <strong>{workspace.banner.title}</strong>
          <p>{workspace.banner.body}</p>
        </div>
      </div>
      {workspace.lane.length > 0 && (
        <div className="workspace-card">
          <div className="workspace-card-heading">
            <h2>Observed lane</h2>
          </div>
          <div className="mp-lane mp-lane--observed mp-lane--compact">
            {workspace.lane.map((node) => (
              <CompactLaneNode key={node.key} node={node} />
            ))}
          </div>
        </div>
      )}
      {workspace.summaryCards.length > 0 && (
        <div className="compact-summary-grid">
          {workspace.summaryCards.map((card) => (
            <div
              className={`compact-summary-card compact-summary-card--${card.tone}`}
              key={card.title}
            >
              <div className="compact-summary-title">{card.title}</div>
              <p>{card.body}</p>
            </div>
          ))}
        </div>
      )}
      {workspace.historyRows && (
        <div className="workspace-card">
          <div className="workspace-card-heading">
            <h2>Append-only outcome history</h2>
          </div>
          <div className="history-table">
            <div className="history-row history-row--head">
              <span>ARTIFACT</span>
              <span>FACT</span>
              <span>TIME</span>
              <span className="history-amount">AMOUNT (INR)</span>
            </div>
            {workspace.historyRows.map((row, index) => (
              <div
                className={`history-row ${row.highlighted ? 'history-row--highlighted' : ''}`}
                key={index}
              >
                <span className={`history-artifact history-artifact--${row.artifactTone}`}>
                  {row.artifact}
                </span>
                <span>
                  {row.fact} {row.note && <span className="cq-mono-dim">{row.note}</span>}
                </span>
                <span className="cq-mono-dim">{row.time}</span>
                <span
                  className={`history-amount ${row.negative ? 'history-amount--negative' : ''}`}
                >
                  {row.amount}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="compact-commands">
        <span className="rail-commands-heading">COMMANDS</span>
        {workspace.commands.map((command) => (
          <CommandButton key={command.label} command={command} />
        ))}
        <span className="compact-commands-note">{workspace.commandsNote}</span>
      </div>
    </div>
  );
}

function GenericWorkspace({ caseId }: { readonly caseId: string }): ReactElement {
  const { identity } = useIdentity();
  // The flagship cases above are hand-authored from the design; every other
  // queue case gets a complete, deterministically-generated workspace derived
  // from its persisted summary, so no queue row is ever a dead end and every
  // case has its own full detail (money path, evidence, control loop).
  const query = { q: caseId };
  const lookup = useQuery({
    queryKey: caseQueueQueryKey(identity.id, query),
    queryFn: ({ signal }) => getCaseQueue(identity.id, query, signal),
  });

  if (lookup.isPending) return <LoadingState label={`Loading ${caseId}`} />;

  const summary = lookup.data?.data.items.find((row) => row.case_id === caseId);
  if (!summary) {
    return (
      <NotFoundState
        title="Case not found."
        body="No case matches this identifier in the current dataset."
        backTo="/cases"
        backLabel="Return to Cases"
      />
    );
  }
  return <PrimaryWorkspace workspace={buildGeneratedWorkspace(summary, caseDisplay(summary))} />;
}

export function CaseWorkspacePage(): ReactElement {
  const { caseId } = useParams<{ caseId: string }>();
  if (!caseId) {
    return (
      <NotFoundState
        title="No case selected."
        body="A case identifier is required."
        backTo="/cases"
        backLabel="Return to Cases"
      />
    );
  }
  const primary = PRIMARY_WORKSPACES[caseId];
  if (primary) return <PrimaryWorkspace workspace={primary} />;
  const compact = COMPACT_WORKSPACES[caseId];
  if (compact) return <CompactWorkspace workspace={compact} />;
  return <GenericWorkspace caseId={caseId} />;
}

export function VerificationTimelinePage(): ReactElement {
  const { caseId } = useParams<{ caseId: string }>();
  if (!caseId) {
    return (
      <NotFoundState
        title="No case selected."
        body="A case identifier is required."
        backTo="/cases"
        backLabel="Return to Cases"
      />
    );
  }
  return (
    <div className="case-workspace-page">
      <Breadcrumb caseId={caseId} />
      <header className="page-heading-block">
        <h1>Verification timeline</h1>
        <p className="page-intro">
          Eleven fixed stages from plan authorization through terminal financial outcome — read
          together with{' '}
          <Link className="overview-text-link" to={`/cases/${caseId}`}>
            the case workspace <ChevronRight aria-hidden="true" size={13} />
          </Link>
          .
        </p>
      </header>
      <VerificationTimeline caseId={caseId} />
    </div>
  );
}
