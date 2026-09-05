import { AlertTriangle, Check, Circle, Square } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  buildVerificationTimeline,
  type TimelineStageVM,
} from '../../data/mocks/verification-timeline.js';
import { EmptyState } from '../shell/states/StatePanels.js';

function StageGlyph({ status }: { readonly status: TimelineStageVM['status'] }): ReactElement {
  if (status === 'complete') {
    return (
      <span className="vt-glyph vt-glyph--complete" role="img" aria-label="Complete">
        <Check aria-hidden="true" size={11} />
      </span>
    );
  }
  if (status === 'acknowledged') {
    return (
      <span
        className="vt-glyph vt-glyph--acknowledged"
        role="img"
        aria-label="Acknowledged, not verification"
      >
        <Square aria-hidden="true" size={11} />
      </span>
    );
  }
  return (
    <span className="vt-glyph vt-glyph--waiting" role="img" aria-label="Waiting">
      <Circle aria-hidden="true" size={11} />
    </span>
  );
}

export function VerificationTimeline({ caseId }: { readonly caseId: string }): ReactElement {
  const bundle = buildVerificationTimeline(caseId);
  const [checked, setChecked] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const recheck = (): void => {
    setChecked('Re-checked just now — stages 5–11 are still waiting; no change to the outcome.');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setChecked(null), 4500);
  };
  if (!bundle) {
    return (
      <EmptyState
        title="No verification timeline is modeled for this case."
        body="No case matches this identifier in the current dataset."
      />
    );
  }
  return (
    <section className="verification-timeline" aria-label="Verification timeline">
      <div className={`vt-banner vt-banner--${bundle.bannerTone}`} role="status">
        <AlertTriangle aria-hidden="true" size={16} />
        <div>
          <strong>{bundle.bannerTitle}</strong>
          <p>{bundle.bannerBody}</p>
          {checked && (
            <p className="vt-recheck-note" role="status">
              {checked}
            </p>
          )}
        </div>
        <button type="button" className="vt-check-status" onClick={recheck}>
          Check status
        </button>
      </div>
      <div className="vt-body">
        <ol className="vt-stage-list">
          {bundle.stages.map((stage) => (
            <li key={stage.index} className={`vt-stage vt-stage--${stage.status}`}>
              <span className="vt-rail">
                <StageGlyph status={stage.status} />
              </span>
              <span className="vt-stage-body">
                <span className="vt-stage-head">
                  <span className="vt-stage-index">{stage.index}</span>
                  <span className="vt-stage-title">{stage.title}</span>
                  <span className={`vt-stage-status vt-stage-status--${stage.status}`}>
                    {stage.statusLabel}
                  </span>
                  {stage.time && <span className="vt-stage-time">{stage.time}</span>}
                  {stage.source && <span className="vt-stage-source">{stage.source}</span>}
                  {stage.requiredForVerified && (
                    <span className="vt-required-tag">REQUIRED FOR VERIFIED</span>
                  )}
                  {stage.reference && <span className="vt-stage-ref">{stage.reference} ›</span>}
                </span>
                <span className="vt-stage-detail">{stage.detail}</span>
              </span>
            </li>
          ))}
        </ol>
        <aside className="vt-sidebar">
          <div className="vt-blockers">
            <div className="vt-blockers-heading">BLOCKERS · {bundle.blockers.length}</div>
            <ul>
              {bundle.blockers.map((blocker) => (
                <li key={blocker.title}>
                  <AlertTriangle aria-hidden="true" size={13} />
                  <span>
                    <strong>{blocker.title}</strong>
                    <span>{blocker.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="vt-side-card">
            <div className="vt-side-heading">SAFE CONCLUSION THAT REMAINS</div>
            <p>{bundle.safeConclusion}</p>
          </div>
          <div className="vt-side-card">
            <div className="vt-side-heading">CONTEXTUAL ACTION</div>
            <button type="button" className="primary-button" onClick={recheck}>
              Check status
            </button>
            {checked && (
              <p className="vt-recheck-note" role="status">
                {checked}
              </p>
            )}
            <p className="vt-mono-note">{bundle.contextualActionNote}</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
