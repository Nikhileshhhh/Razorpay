import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ArtifactType } from '../../../contracts/index.js';
import { useIdentity } from '../../app/identity.js';
import { caseQueueQueryKey, getCaseQueue } from '../../data/cases.js';
import {
  AUDIT_CATEGORIES,
  buildGeneratedAudit,
  cardTemplateLabel,
  CASE_2077_BUNDLE,
  categoryForType,
  type AuditBundle,
  type AuditCategoryKey,
  type AuditRowVM,
  type DetailField,
  type HashPair,
} from '../../data/mocks/audit.js';
import { caseDisplay } from '../../data/mocks/cases.js';
import { formatMoney } from '../../formatting/money.js';

const SUPPORTED_CASE_ID = 'CASE-2077';
/** Verification contract run — matches the design's default selected artifact (frame 1a). */
const DEFAULT_SEQUENCE = 31;

/* -------------------------------------------------------------------------- */
/*  Category glyphs — one shape per category, never colour-only               */
/* -------------------------------------------------------------------------- */

function CategoryGlyph({
  category,
  size = 9,
}: {
  readonly category: AuditCategoryKey;
  readonly size?: number;
}): ReactElement {
  switch (category) {
    case 'source-facts':
      return (
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
          <rect width="12" height="12" rx="1.5" fill="#2c3e55" />
        </svg>
      );
    case 'derived-controls':
      return (
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 0l6 6-6 6L0 6z" fill="#1450b4" />
        </svg>
      );
    case 'investigation':
      return (
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="6" cy="6" r="5" fill="none" stroke="#55408f" strokeWidth="2" />
        </svg>
      );
    case 'policy':
      return (
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 .5 11.5 11h-11z" fill="#10614d" />
        </svg>
      );
    case 'human-approval':
      return (
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="6" cy="6" r="6" fill="#1c6b32" />
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
    case 'simulated-action':
      return (
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
          <rect
            x="1"
            y="1"
            width="10"
            height="10"
            rx="1"
            fill="none"
            stroke="#7a4d06"
            strokeWidth="1.6"
            strokeDasharray="3 2"
          />
        </svg>
      );
    case 'verification':
      return (
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 .8l5.2 5.2L6 11.2.8 6z" fill="none" stroke="#1450b4" strokeWidth="1.8" />
        </svg>
      );
    case 'reversal-admin-demo':
      return (
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
          <rect x="2" y="2" width="8" height="8" fill="#14181f" />
        </svg>
      );
  }
}

/** Per-artifact-type row glyph — finer grained than the category glyph. */
function TypeGlyph({
  type,
  size = 10,
}: {
  readonly type: ArtifactType;
  readonly size?: number;
}): ReactElement {
  switch (type) {
    case 'EVIDENCE':
      return <CategoryGlyph category="source-facts" size={size} />;
    case 'CASE_TRANSITION':
      return <CategoryGlyph category="derived-controls" size={size} />;
    case 'MANUAL_LINK':
      return (
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 0l6 6-6 6L0 6z" fill="none" stroke="#1450b4" strokeWidth="1.8" />
        </svg>
      );
    case 'AGENT_CLAIM':
      return (
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
          <circle
            cx="6"
            cy="6"
            r="5"
            fill="none"
            stroke="#55408f"
            strokeWidth="2"
            strokeDasharray="3 2"
          />
        </svg>
      );
    case 'INVESTIGATION':
    case 'FINDING':
    case 'CLAIM_EVALUATION':
      return <CategoryGlyph category="investigation" size={size} />;
    case 'POLICY_DECISION':
      return <CategoryGlyph category="policy" size={size} />;
    case 'APPROVAL':
      return <CategoryGlyph category="human-approval" size={size} />;
    case 'ACTION':
      return <CategoryGlyph category="simulated-action" size={size} />;
    case 'VERIFICATION':
      return <CategoryGlyph category="verification" size={size} />;
    case 'RECONCILIATION':
    case 'RECEIVABLE_CLOSURE':
      return (
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
          <rect y="2" width="12" height="2.4" rx="1" fill="#3a4453" />
          <rect y="7.6" width="12" height="2.4" rx="1" fill="#3a4453" />
        </svg>
      );
    case 'RECONCILIATION_REVERSAL':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M13.2 8a5.2 5.2 0 1 1-1.7-3.85"
            stroke="#14181f"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M13.4 1.9v2.9h-2.9"
            stroke="#14181f"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'ADMIN_CHANGE':
    case 'DATASET_IMPORT':
    case 'DEMO_COMMAND':
      return <CategoryGlyph category="reversal-admin-demo" size={size} />;
  }
}

function NotRecordedGlyph(): ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="#8b95a5" strokeWidth="1.4" />
      <path d="M4.6 11.4 11.4 4.6" stroke="#8b95a5" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
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

function DownloadGlyph(): ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.5v7.4M5.2 7.2 8 10l2.8-2.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M2.6 12.4h10.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Small shared pieces                                                        */
/* -------------------------------------------------------------------------- */

function HashField({
  hash,
  label,
}: {
  readonly hash: HashPair;
  readonly label: string;
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
    <span className="aud-hash">
      <span className="aud-hash-value" aria-label={`${label} ${hash.full}`}>
        {revealed ? hash.full : hash.short}
      </span>
      <button
        type="button"
        className="aud-copy"
        aria-label={`Copy full ${label}`}
        title={`Copy full ${label}`}
        onClick={copy}
      >
        <CopyGlyph />
      </button>
      <button
        type="button"
        className="aud-reveal"
        aria-expanded={revealed}
        onClick={() => setRevealed((open) => !open)}
      >
        {revealed ? 'Hide' : 'Reveal'}
      </button>
      {copied && (
        <span className="aud-hash-note aud-hash-note--copied" role="status">
          copied
        </span>
      )}
    </span>
  );
}

function NotRecorded({ label }: { readonly label: string }): ReactElement {
  return (
    <span className="aud-not-recorded" aria-label={`${label}: not recorded for this artifact`}>
      <NotRecordedGlyph />
      Not recorded for this artifact
    </span>
  );
}

function DetailFieldValue({ field }: { readonly field: DetailField }): ReactElement {
  switch (field.kind) {
    case 'text':
      return (
        <span
          className={`aud-field-text${field.mono ? ' aud-mono' : ''}${field.strong ? ' aud-strong' : ''}${field.tone ? ` aud-tone-${field.tone}` : ''}`}
        >
          {field.text}
        </span>
      );
    case 'money':
      return (
        <span className={`aud-field-money${field.tone ? ` aud-tone-${field.tone}` : ''}`}>
          {formatMoney(field.money).replace(' INR', '')} <span className="aud-money-unit">INR</span>
        </span>
      );
    case 'coverage':
      return (
        <span className="aud-coverage">
          {field.coverage.label}
          <span
            className="aud-coverage-bars"
            role="img"
            aria-label={`${field.coverage.done} of ${field.coverage.total} evidence steps`}
          >
            {Array.from({ length: field.coverage.total }, (_, i) => (
              <span key={i} className={i < field.coverage.done ? 'is-done' : ''} />
            ))}
          </span>
          <span className="aud-coverage-count">
            {field.coverage.done} / {field.coverage.total}
          </span>
        </span>
      );
    case 'notRecorded':
      return <NotRecorded label={field.label} />;
  }
}

/* -------------------------------------------------------------------------- */
/*  Timeline                                                                   */
/* -------------------------------------------------------------------------- */

function Timeline({
  rows,
  windowRows,
  selectedId,
  onSelect,
  totalEntries,
}: {
  readonly rows: readonly AuditRowVM[];
  readonly windowRows: readonly AuditRowVM[];
  readonly selectedId: string | null;
  readonly onSelect: (row: AuditRowVM) => void;
  readonly totalEntries: number;
}): ReactElement {
  const first = windowRows[0];
  const last = windowRows[windowRows.length - 1];
  return (
    <section aria-label="Ordered artifact timeline" className="aud-timeline">
      <div className="aud-panel-head">
        <h2>Artifact timeline</h2>
        <span className="aud-panel-head-note">server audit_sequence · not sortable</span>
      </div>
      {windowRows.length === 0 ? (
        <div className="aud-empty aud-empty--inline">
          <div className="aud-empty-title">No artifacts in this range match these categories</div>
          <p>
            Both filters and the cursor are still applied and still in the URL. The case has{' '}
            {totalEntries} entries; {rows.length} match{rows.length === 1 ? 'es' : ''} these
            categories in this range.
          </p>
        </div>
      ) : (
        <ol className="aud-artifact-list">
          {windowRows.map((row) => (
            <li key={row.artifactId}>
              <button
                type="button"
                className="aud-artifact"
                aria-current={selectedId === row.artifactId ? 'true' : undefined}
                onClick={() => onSelect(row)}
              >
                <span className="aud-artifact-seq">#{row.sequence}</span>
                <span className="aud-artifact-glyph">
                  <TypeGlyph type={row.artifactType} />
                </span>
                <span className="aud-artifact-body">
                  <span className="aud-artifact-type">{row.artifactType}</span>
                  <span className="aud-artifact-summary">{row.rowSummary}</span>
                  <span className="aud-artifact-meta">
                    {row.actor} · {row.createdLocalShort}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="aud-timeline-foot">
        <span role="status" aria-live="polite">
          {windowRows.length > 0 ? (
            <>
              Sequences{' '}
              <span className="aud-mono aud-strong">
                #{first?.sequence}–#{last?.sequence}
              </span>{' '}
              · {windowRows.length} of {rows.length}
            </>
          ) : (
            <>0 of {rows.length}</>
          )}
        </span>
        <span className="aud-timeline-nav">
          <button type="button" className="aud-nav-btn" disabled>
            Previous
          </button>
          <button type="button" className="aud-nav-btn">
            Next
          </button>
        </span>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Selected artifact detail                                                   */
/* -------------------------------------------------------------------------- */

function ArtifactDetail({
  row,
  onSelectSequence,
  caseId,
}: {
  readonly row: AuditRowVM;
  readonly onSelectSequence: (sequence: number) => void;
  readonly caseId: string;
}): ReactElement {
  const [metadataOpen, setMetadataOpen] = useState(false);
  const templateLabel = cardTemplateLabel(row.artifactType);
  return (
    <section aria-label="Selected artifact detail" className="aud-detail">
      <div className="aud-detail-head">
        <div className="aud-detail-badges">
          <span className="aud-kind-chip">
            <TypeGlyph type={row.artifactType} size={9} />
            {row.kindLabel}
          </span>
          <span className="aud-type-mono">{row.artifactType}</span>
          <span className="aud-seq-mono">sequence #{row.sequence}</span>
        </div>
        <h2>{row.title}</h2>
        <div className="aud-detail-outcome-row">
          {row.outcome && (
            <span className={`aud-outcome-badge aud-outcome-badge--${row.outcome.tone}`}>
              <TypeGlyph type={row.artifactType} size={10} />
              Result · {row.outcome.label}
            </span>
          )}
          <span className="aud-artifact-id-note">artifact ID {row.artifactId} · immutable</span>
        </div>
        <p className="aud-explanation">{row.explanation}</p>
      </div>

      <div className="aud-detail-body">
        <div className="aud-primary-card">
          <div className="aud-primary-card-head">{templateLabel.toUpperCase()} CARD TEMPLATE</div>
          <div className="aud-field-grid">
            {row.fields.map((field) => (
              <div className="aud-field-row" key={field.label}>
                <span className="aud-field-label">{field.label}</span>
                <DetailFieldValue field={field} />
              </div>
            ))}
          </div>
        </div>

        <div className="aud-related-card">
          <div className="aud-card-head">RELATED ARTIFACTS AND CASE</div>
          <div className="aud-related-list">
            {row.related.length === 0 ? (
              <span className="aud-dim">No related artifacts recorded.</span>
            ) : (
              row.related.map((ref, index) => (
                <RelatedLink
                  key={index}
                  reference={ref}
                  onSelectSequence={onSelectSequence}
                  caseId={caseId}
                />
              ))
            )}
          </div>
        </div>

        <div className="aud-metadata-toggle-card">
          <div className="aud-card-head">
            SAFE STRUCTURED METADATA
            <button
              type="button"
              className="aud-expand-btn"
              aria-expanded={metadataOpen}
              onClick={() => setMetadataOpen((open) => !open)}
            >
              {metadataOpen ? 'Collapse' : 'Expand'}
            </button>
          </div>
          {metadataOpen ? (
            <div className="aud-metadata-table">
              {row.fields.map((field) => (
                <div className="aud-metadata-row" key={field.label}>
                  <span>{field.label}</span>
                  <DetailFieldValue field={field} />
                </div>
              ))}
              <div className="aud-metadata-row">
                <span>Artifact hash</span>
                <span className="aud-mono">{row.metadata.artifactHash.full}</span>
              </div>
            </div>
          ) : (
            <p className="aud-metadata-collapsed">
              Collapsed by default — raw JSON is never the default content. Expanding shows a
              redacted key/value table of the persisted artifact, not a payload dump.
            </p>
          )}
        </div>

        <p className="aud-card-templates-note">
          <b>Card templates by category.</b> Source facts lead with event type and amount;
          investigation with mode, prompt and schema versions plus a safe-to-act verdict; policy
          with bundle version, decision and matched rules; approval with requester, approver,
          decision, expiry and basis hash; action with type, status, idempotency reference,
          synthetic external reference and &quot;No real money movement&quot;; verification with
          contract, coverage, blockers, result and amount; reconciliation with allocation status,
          bank reference, expectation, difference, closure and reversal; demo/admin with command,
          operator and dataset version. All eight share the same hierarchy — label, title, sequence,
          artifact ID, explanation, outcome, related links.
        </p>
      </div>
    </section>
  );
}

function RelatedLink({
  reference,
  onSelectSequence,
  caseId,
}: {
  readonly reference: AuditRowVM['related'][number];
  readonly onSelectSequence: (sequence: number) => void;
  readonly caseId: string;
}): ReactElement {
  const content = (
    <>
      <span className="aud-related-seq">{reference.sequence ? `#${reference.sequence}` : '—'}</span>
      <span className="aud-related-type">{reference.typeLabel}</span>
      <span className="aud-related-text">{reference.text}</span>
    </>
  );
  if (reference.sequence) {
    return (
      <button
        type="button"
        className="aud-related-link"
        onClick={() => onSelectSequence(reference.sequence!)}
      >
        {content}
      </button>
    );
  }
  return (
    <Link className="aud-related-link" to={`/cases/${caseId}`}>
      {content}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*  Forensic metadata panel                                                    */
/* -------------------------------------------------------------------------- */

function ForensicMetadata({ row }: { readonly row: AuditRowVM }): ReactElement {
  const meta = row.metadata;
  return (
    <section aria-label="Forensic metadata" className="aud-metadata-panel">
      <div className="aud-panel-head">
        <h2>Forensic metadata</h2>
      </div>
      <div className="aud-metadata-scroll">
        <div className="aud-meta-block">
          <MetaItem label="IDENTITY / ACTOR">
            {meta.identityActor}
            {meta.identitySub && (
              <span className="aud-mono aud-dim aud-meta-sub"> {meta.identitySub}</span>
            )}
          </MetaItem>
          <MetaItem label="ACTOR ROLE">{meta.actorRole}</MetaItem>
          <MetaItem label="SCHEMA VERSION" mono>
            {meta.schemaVersion}
          </MetaItem>
          <MetaItem label="CONTRACT VERSION" mono>
            {meta.contractVersion ?? <NotRecorded label="contract version" />}
          </MetaItem>
          <MetaItem label="RESOURCE VERSION" mono>
            {meta.resourceVersion ?? <NotRecorded label="resource version" />}
          </MetaItem>
          <MetaItem label="POLICY VERSION" mono>
            {meta.policyVersion ?? <NotRecorded label="policy version" />}
          </MetaItem>
          <MetaItem label="PROMPT / MODEL VERSION">
            {meta.promptModelVersion ?? <NotRecorded label="prompt / model version" />}
          </MetaItem>
        </div>
        <div className="aud-meta-divider" />
        <div className="aud-meta-block">
          <MetaItem label="ARTIFACT HASH">
            <HashField hash={meta.artifactHash} label="artifact hash" />
          </MetaItem>
          {meta.evidenceSetHash && (
            <MetaItem label="EVIDENCE-SET HASH">
              <HashField hash={meta.evidenceSetHash} label="evidence-set hash" />
            </MetaItem>
          )}
          <MetaItem label="REQUEST ID" mono>
            {meta.requestId ?? <NotRecorded label="request ID" />}
          </MetaItem>
          <MetaItem label="CORRELATION ID" mono>
            {meta.correlationId ?? <NotRecorded label="correlation ID" />}
          </MetaItem>
        </div>
        <div className="aud-meta-divider" />
        <div className="aud-meta-block">
          <MetaItem label="CREATED (LOCAL)" mono>
            {row.createdLocalFull}
          </MetaItem>
          <MetaItem label="CREATED (UTC)" mono>
            {row.createdUtc}
          </MetaItem>
          <MetaItem label="SEQUENCE AUTHORITY">
            <span className="aud-authority-note">
              Order comes from audit_sequence #{row.sequence}. This timestamp is informative only.
            </span>
          </MetaItem>
        </div>
        <div className="aud-metadata-safe-note">
          Safe metadata and redacted references only. No secrets, credentials, webhook signatures,
          raw bank or card data, PII, hidden labels, chain-of-thought, or provider errors are ever
          rendered here.
        </div>
      </div>
    </section>
  );
}

function MetaItem({
  label,
  mono,
  children,
}: {
  readonly label: string;
  readonly mono?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="aud-meta-item">
      <span className="aud-meta-label">{label}</span>
      <span className={mono ? 'aud-meta-value aud-mono' : 'aud-meta-value'}>{children}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Category filter bar                                                        */
/* -------------------------------------------------------------------------- */

function CategoryFilters({
  selected,
  onToggle,
  onClear,
  totalEntries,
  categoryTotals,
}: {
  readonly selected: ReadonlySet<AuditCategoryKey>;
  readonly onToggle: (key: AuditCategoryKey) => void;
  readonly onClear: () => void;
  readonly totalEntries: number;
  readonly categoryTotals: Readonly<Record<AuditCategoryKey, number>>;
}): ReactElement {
  return (
    <div className="aud-filter-row" role="group" aria-label="Artifact category filter">
      <span className="aud-filter-label">CATEGORY</span>
      <button
        type="button"
        className={`aud-cat-chip${selected.size === 0 ? ' aud-cat-chip--active' : ''}`}
        onClick={onClear}
      >
        All artifacts <span className="aud-cat-count">{totalEntries}</span>
      </button>
      {AUDIT_CATEGORIES.map((category) => {
        const active = selected.has(category.key);
        return (
          <button
            key={category.key}
            type="button"
            className={`aud-cat-chip${active ? ' aud-cat-chip--active' : ''}`}
            aria-pressed={active}
            onClick={() => onToggle(category.key)}
          >
            <CategoryGlyph category={category.key} />
            {category.label}
            <span className="aud-cat-count">{categoryTotals[category.key]}</span>
          </button>
        );
      })}
      {selected.size > 0 && (
        <>
          {[...selected].map((key) => {
            const category = AUDIT_CATEGORIES.find((c) => c.key === key)!;
            return (
              <span className="aud-applied-chip" key={key}>
                {category.label}
                <button
                  type="button"
                  aria-label={`Remove ${category.label} filter`}
                  onClick={() => onToggle(key)}
                >
                  ×
                </button>
              </span>
            );
          })}
          <button type="button" className="aud-clear-filters" onClick={onClear}>
            Clear filters
          </button>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Export dialog                                                              */
/* -------------------------------------------------------------------------- */

function ExportDialog({
  onClose,
  exportInfo,
  caseId,
}: {
  readonly onClose: () => void;
  readonly exportInfo: AuditBundle['export'];
  readonly caseId: string;
}): ReactElement {
  const [downloaded, setDownloaded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard?.writeText(exportInfo.contentSha256.full).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      },
      () => undefined,
    );
  };

  const download = (): void => {
    setDownloaded(true);
  };

  return (
    <div className="drawer-overlay" role="presentation" onClick={onClose}>
      <div
        className="aud-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aud-export-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="aud-export-head">
          <h3 id="aud-export-title">Redacted audit bundle ready</h3>
          <p>
            Generated by the backend under your redaction profile. The values below are returned by
            the server and echoed in a safe response header.
          </p>
        </div>
        <div className="aud-dialog-grid">
          <span className="aud-field-label">Case ID</span>
          <span className="aud-mono aud-strong">{caseId}</span>
          <span className="aud-field-label">Generated at</span>
          <span>
            {exportInfo.generatedAtLocal}{' '}
            <span className="aud-mono aud-dim aud-tiny">({exportInfo.generatedAtUtc})</span>
          </span>
          <span className="aud-field-label">Entry count</span>
          <span className="aud-mono aud-strong">{exportInfo.entryCount}</span>
          <span className="aud-field-label">Redaction profile</span>
          <span className="aud-mono">{exportInfo.redactionProfile}</span>
          <span className="aud-field-label">Content SHA-256</span>
          <HashField hash={exportInfo.contentSha256} label="content SHA-256" />
        </div>
        <div className="aud-export-note">
          <b>This hash is the server&rsquo;s.</b> The browser downloads the bundle as returned and
          never recomputes, verifies or derives the authoritative hash locally. Copy hash copies the
          server value verbatim.
        </div>
        <div className="aud-export-actions">
          <button type="button" className="aud-btn aud-btn--primary" onClick={download}>
            <DownloadGlyph />
            Download JSON
          </button>
          <button type="button" className="aud-btn aud-btn--ghost" onClick={copy}>
            Copy hash
          </button>
          <button type="button" className="aud-btn aud-btn--ghost" onClick={onClose}>
            Close
          </button>
          <span className="aud-export-endpoint">GET /v1/cases/:id/audit/export</span>
        </div>
        {(downloaded || copied) && (
          <p className="aud-export-feedback" role="status">
            {downloaded && 'Bundle downloaded. '}
            {copied && 'Hash copied.'}
          </p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Empty / not-found states                                                   */
/* -------------------------------------------------------------------------- */

function NoCaseSelected({
  caseInput,
  onChange,
  onOpen,
  onTrySupported,
}: {
  readonly caseInput: string;
  readonly onChange: (value: string) => void;
  readonly onOpen: () => void;
  readonly onTrySupported: () => void;
}): ReactElement {
  return (
    <div className="aud-shell-empty">
      <div className="aud-case-selector-card">
        <h3>Audit Replay</h3>
        <p>Ordered, immutable facts and decisions for a financial case.</p>
        <div className="aud-case-selector-row">
          <label className="aud-case-field">
            <span className="aud-filter-label">CASE ID</span>
            <span className="aud-case-input">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" stroke="#8b95a5" strokeWidth="1.4" />
                <path
                  d="M10.4 10.4 14 14"
                  stroke="#8b95a5"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
              <input
                value={caseInput}
                onChange={(event) => onChange(event.target.value)}
                placeholder="CASE-… or a supported identifier"
                onKeyDown={(event) => event.key === 'Enter' && onOpen()}
              />
            </span>
          </label>
          <button type="button" className="aud-btn aud-btn--ghost" onClick={onOpen}>
            Open replay
          </button>
          <span className="aud-case-selector-note">
            export unavailable until a case is selected
          </span>
        </div>
      </div>
      <div className="aud-empty aud-empty--panel">
        <span className="aud-empty-icon">
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 3.5h10M3 8h10M3 12.5h6"
              stroke="#5b6472"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <div className="aud-empty-title">Select a case to replay its audit</div>
        <p>
          Audit Replay is always scoped to one case. Enter a supported Case ID above, or open the
          replay from a case — the case page&rsquo;s &quot;View audit replay&quot; link carries the
          case and preserves your return path. No timeline is shown until a case is selected;
          nothing here is fabricated.
        </p>
        <p className="aud-empty-suggestion">
          This demo has a full audit trail for one worked example —{' '}
          <button type="button" className="aud-inline-link" onClick={onTrySupported}>
            open {SUPPORTED_CASE_ID}
          </button>
          . Every other case in the queue exists but its audit trail is not yet modeled here.
        </p>
      </div>
    </div>
  );
}

function CaseNotFound({ onBack }: { readonly onBack: () => void }): ReactElement {
  return (
    <div className="aud-not-found">
      <div className="aud-empty-title">This audit replay is not available</div>
      <p>
        No audit replay is available for this identifier under your current role. Return to the
        audit page to select another case.
      </p>
      <button type="button" className="aud-btn aud-btn--ghost" onClick={onBack}>
        Back to Audit Replay
      </button>
      <p className="aud-not-found-note">
        One wording for every cause — another tenant&rsquo;s case, a never-issued identifier, or an
        out-of-scope case. Nothing distinguishes them, and no provider or database error text is
        surfaced.
      </p>
    </div>
  );
}

function LoadingShell(): ReactElement {
  return (
    <div className="aud-loading-shell" aria-busy="true">
      <div className="aud-loading-col aud-loading-col--narrow">
        <span className="aud-sk aud-sk--label" />
        {Array.from({ length: 5 }, (_, i) => (
          <span className="aud-sk" key={i} />
        ))}
      </div>
      <div className="aud-loading-col aud-loading-col--wide">
        <span className="aud-sk aud-sk--label" />
        <span className="aud-sk aud-sk--title" />
        <span className="aud-sk" />
        <span className="aud-sk aud-sk--wide" />
        <span className="aud-sk aud-sk--card" />
      </div>
      <div className="aud-loading-col aud-loading-col--narrow">
        <span className="aud-sk aud-sk--label" />
        <span className="aud-sk" />
        <span className="aud-sk" />
        <span className="aud-sk aud-sk--wide" />
      </div>
      <span role="status" className="sr-only">
        Loading audit replay
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export function AuditReplayPage(): ReactElement {
  const { identity } = useIdentity();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlCase = searchParams.get('case') ?? '';
  const urlArtifact = searchParams.get('artifact');
  const urlCategories = searchParams.get('cat');

  const [caseInput, setCaseInput] = useState(urlCase);
  const [loading, setLoading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const activeCase = urlCase.trim().toUpperCase();
  const isFlagship = activeCase === SUPPORTED_CASE_ID;

  // Every case in the queue gets a deterministically-generated audit bundle; the
  // flagship keeps its hand-authored one. Only a genuinely unknown/cross-tenant
  // identifier has no bundle and stays opaque per CaseNotFound.
  const otherCaseQuery = { q: activeCase };
  const otherCaseLookup = useQuery({
    queryKey: caseQueueQueryKey(identity.id, otherCaseQuery),
    queryFn: ({ signal }) => getCaseQueue(identity.id, otherCaseQuery, signal),
    enabled: activeCase.length > 0 && !isFlagship,
  });
  const otherSummary = otherCaseLookup.data?.data.items.find((row) => row.case_id === activeCase);

  const bundle = useMemo<AuditBundle | null>(() => {
    if (isFlagship) return CASE_2077_BUNDLE;
    if (otherSummary) return buildGeneratedAudit(otherSummary, caseDisplay(otherSummary));
    return null;
  }, [isFlagship, otherSummary]);

  const caseResolved = bundle !== null;
  const caseNotFound =
    activeCase.length > 0 && !isFlagship && !otherCaseLookup.isPending && !otherSummary;

  const selectedCategories = useMemo<ReadonlySet<AuditCategoryKey>>(
    () => new Set((urlCategories?.split(',').filter(Boolean) ?? []) as AuditCategoryKey[]),
    [urlCategories],
  );

  const filteredRows = useMemo(() => {
    const rows = bundle?.rows ?? [];
    if (selectedCategories.size === 0) return rows;
    return rows.filter((row) => selectedCategories.has(categoryForType(row.artifactType).key));
  }, [selectedCategories, bundle]);

  const selectedRow = useMemo(() => {
    if (urlArtifact) {
      const explicit = filteredRows.find((row) => row.artifactId === urlArtifact);
      if (explicit) return explicit;
    }
    const defaultRow = filteredRows.find((row) => row.sequence === DEFAULT_SEQUENCE);
    return defaultRow ?? filteredRows[filteredRows.length - 1] ?? null;
  }, [urlArtifact, filteredRows]);

  const setParams = (next: {
    case?: string;
    artifact?: string | null;
    cat?: string | null;
  }): void => {
    const params = new URLSearchParams(searchParams);
    if (next.case !== undefined) {
      if (next.case === '') params.delete('case');
      else params.set('case', next.case);
    }
    if (next.artifact !== undefined) {
      if (next.artifact === null) params.delete('artifact');
      else params.set('artifact', next.artifact);
    }
    if (next.cat !== undefined) {
      if (next.cat === null || next.cat === '') params.delete('cat');
      else params.set('cat', next.cat);
    }
    setSearchParams(params, { replace: true });
  };

  const openCase = (): void => {
    const value = caseInput.trim().toUpperCase();
    if (!value) return;
    setLoading(true);
    setParams({ case: value, artifact: null });
  };

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setLoading(false), 450);
    return () => window.clearTimeout(timer);
  }, [loading]);

  const toggleCategory = (key: AuditCategoryKey): void => {
    const next = new Set(selectedCategories);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setParams({ cat: [...next].join(',') || null, artifact: null });
  };
  const clearFilters = (): void => setParams({ cat: null, artifact: null });

  const selectRow = (row: AuditRowVM): void => setParams({ artifact: row.artifactId });
  const selectSequence = (sequence: number): void => {
    const row = (bundle?.rows ?? []).find((r) => r.sequence === sequence);
    if (row) setParams({ artifact: row.artifactId });
  };

  const queryStringDisplay = `?${searchParams.toString() || `case=${activeCase || SUPPORTED_CASE_ID}`}`;

  return (
    <div className="aud-page">
      <nav className="mobile-breadcrumbs" aria-label="Breadcrumb">
        <Link to={caseResolved ? `/cases/${activeCase}` : '/cases'}>
          {caseResolved ? `Back to ${activeCase}` : 'Cases'}
        </Link>
        <span aria-hidden="true">/</span>
        <strong aria-current="page">Audit Replay</strong>
      </nav>

      <div className="aud-header-row">
        <div>
          <h1>Audit Replay</h1>
          <p>Ordered, immutable facts and decisions for a financial case.</p>
        </div>
        <label className="aud-case-field aud-case-field--header">
          <span className="aud-filter-label">CASE ID</span>
          <span className="aud-case-input">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" stroke="#8b95a5" strokeWidth="1.4" />
              <path d="M10.4 10.4 14 14" stroke="#8b95a5" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              value={caseInput}
              onChange={(event) => setCaseInput(event.target.value)}
              placeholder="CASE-…"
              onKeyDown={(event) => event.key === 'Enter' && openCase()}
            />
            {caseInput && (
              <button
                type="button"
                aria-label="Clear selected case"
                onClick={() => {
                  setCaseInput('');
                  setParams({ case: '', artifact: null, cat: null });
                }}
              >
                ×
              </button>
            )}
          </span>
        </label>
        <button
          type="button"
          className="aud-btn aud-btn--primary"
          disabled={!caseResolved}
          onClick={() => setExportOpen(true)}
        >
          <DownloadGlyph />
          Export redacted audit
        </button>
      </div>

      {!urlCase ? (
        <NoCaseSelected
          caseInput={caseInput}
          onChange={setCaseInput}
          onOpen={openCase}
          onTrySupported={() => {
            setCaseInput(SUPPORTED_CASE_ID);
            setParams({ case: SUPPORTED_CASE_ID, artifact: null });
          }}
        />
      ) : loading || (!isFlagship && otherCaseLookup.isPending) ? (
        <LoadingShell />
      ) : caseNotFound || !bundle ? (
        <CaseNotFound onBack={() => setParams({ case: '' })} />
      ) : (
        <>
          <div className="aud-context-strip">
            <span>
              case <b>{activeCase}</b>
            </span>
            <span>
              audit entries <b>{bundle.totalEntries}</b>
            </span>
            <span>
              latest sequence <b>#{bundle.latestSequence}</b>
            </span>
            <span>
              redaction profile <b>{bundle.redactionProfile}</b>
            </span>
            <span>
              role <b>{bundle.demoRole}</b>
            </span>
            <span className="aud-context-url">{queryStringDisplay}</span>
          </div>

          <CategoryFilters
            selected={selectedCategories}
            onToggle={toggleCategory}
            onClear={clearFilters}
            totalEntries={bundle.totalEntries}
            categoryTotals={bundle.categoryTotals}
          />

          <div className="aud-columns">
            <Timeline
              rows={filteredRows}
              windowRows={filteredRows}
              selectedId={selectedRow?.artifactId ?? null}
              onSelect={selectRow}
              totalEntries={bundle.totalEntries}
            />
            {selectedRow ? (
              <ArtifactDetail
                row={selectedRow}
                onSelectSequence={selectSequence}
                caseId={activeCase}
              />
            ) : (
              <section
                aria-label="Selected artifact detail"
                className="aud-detail aud-detail--empty"
              >
                <div className="aud-empty aud-empty--panel">
                  <div className="aud-empty-title">No artifact selected.</div>
                  <p>Select an artifact from the timeline to view its immutable detail.</p>
                </div>
              </section>
            )}
            {selectedRow ? (
              <ForensicMetadata row={selectedRow} />
            ) : (
              <section aria-label="Forensic metadata" className="aud-metadata-panel" />
            )}
          </div>
        </>
      )}

      {exportOpen && bundle && (
        <ExportDialog
          onClose={() => setExportOpen(false)}
          exportInfo={bundle.export}
          caseId={activeCase}
        />
      )}
    </div>
  );
}
