import type { CaseSummary, Money } from '../../../contracts/index.js';
import { formatMoney } from '../../formatting/money.js';
import type { CaseDisplayMeta } from './cases.js';
import type {
  EvidenceRowVM,
  MoneyPathNodeVM,
  OperatorNoteVM,
  PrimaryWorkspaceVM,
  RailCardVM,
} from './case-workspace.js';

/**
 * Deterministic full-workspace generator. Every queue case that isn't one of the
 * hand-authored flagship workspaces gets a complete CASE-2077-style
 * `PrimaryWorkspaceVM` derived purely from its own persisted summary (exposure,
 * control, lifecycle, outcome, evidence coverage, contradictions, owner, opened
 * date) plus its display metadata. A cheap case-id seed varies references, times
 * and sequence numbers so each case reads distinctly but stably across reloads —
 * no random values, so the page never changes shape between renders.
 */

const CONTROL_LABELS: Readonly<Record<string, string>> = {
  'CTL-02': 'settlement timeout after capture',
  'CTL-04': 'transfer not observed at payout',
  'CTL-05': 'conflicting bank evidence',
  'CTL-09': 'unsafe candidate match',
  'CTL-11': 'refund correlation divergence',
};

const OWNER_ROLES: Readonly<Record<string, string>> = {
  'A. Rao': 'user_investigator',
  'S. Menon': 'user_approver',
  'K. Iyer': 'user_investigator',
  'P. Shah': 'user_case_manager',
};

function seedOf(caseId: string): number {
  let hash = 0;
  for (let index = 0; index < caseId.length; index += 1) {
    hash = (hash * 31 + caseId.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function hex(seed: number, salt: number): string {
  return (((seed ^ (salt * 2654435761)) >>> 0) % 0xffff).toString(16).padStart(4, '0');
}

function istDateTime(iso: string, addMinutes = 0): string {
  const base = new Date(iso);
  if (Number.isNaN(base.getTime())) return iso;
  const shifted = new Date(base.getTime() + addMinutes * 60_000);
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  })
    .format(shifted)
    .replace(',', '')
    .concat(' IST');
}

function utcTitle(iso: string, addMinutes = 0): string {
  const base = new Date(iso);
  if (Number.isNaN(base.getTime())) return iso;
  const shifted = new Date(base.getTime() + addMinutes * 60_000);
  return `${new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(shifted)} UTC`;
}

function ageSince(iso: string): string {
  const opened = new Date(iso).getTime();
  const now = new Date('2026-08-25T05:20:00Z').getTime();
  const hours = Math.max(0, Math.round((now - opened) / 3_600_000));
  const days = Math.floor(hours / 24);
  const remaining = hours % 24;
  return days > 0 ? `${days}d ${remaining}h` : `${remaining}h`;
}

function materialityFor(exposure: Money): string {
  const minor = BigInt(exposure.amount_minor);
  if (minor >= 50000000n) return 'Material · P1';
  if (minor > 0n) return 'Material · P2';
  return 'Immaterial · P4';
}

type OutcomeTone = PrimaryWorkspaceVM['outcomeTone'];

function outcomeToneFor(outcome: string): OutcomeTone {
  switch (outcome) {
    case 'VERIFIED':
      return 'success';
    case 'REVERSED':
      return 'purple';
    case 'ACTION_PENDING':
      return 'warning';
    case 'EXPECTED':
      return 'slate';
    case 'DIVERGED':
    case 'UNRESOLVED':
    default:
      return 'danger';
  }
}

function lifecycleLabel(state: string): string {
  return state.replaceAll('_', ' ').toUpperCase();
}

function buildLanes(summary: CaseSummary): {
  expectedLane: MoneyPathNodeVM[];
  observedLane: MoneyPathNodeVM[];
} {
  const coverage = summary.evidence_coverage;
  const amount = summary.exposure;
  const expectedLane: MoneyPathNodeVM[] = [
    { key: 'e1', kind: 'expected', label: 'Capture', status: 'Expected' },
    { key: 'e2', kind: 'expected', label: 'Obligation', status: 'Expected' },
    { key: 'e3', kind: 'expected', label: 'Transfer', status: 'Expected' },
    { key: 'e4', kind: 'expected', label: 'Bank credit', status: 'Expected' },
    { key: 'e5', kind: 'expected', label: 'ERP closure', status: 'Expected' },
  ];
  const observedLane: MoneyPathNodeVM[] = [
    {
      key: 'o1',
      kind: 'source_fact',
      label: 'Capture',
      status: 'Observed',
      amount,
      caption: `${istDateTime(summary.opened_at, 12)} · payments API · signature verified`,
    },
    {
      key: 'o2',
      kind: 'derived',
      label: 'Obligation',
      status: 'Observed',
      amount,
      caption: `${summary.control_id} · derived`,
    },
  ];
  if (coverage === 'complete') {
    observedLane.push(
      { key: 'o3', kind: 'source_fact', label: 'Transfer', status: 'Observed', amount },
      { key: 'o4', kind: 'source_fact', label: 'Bank credit', status: 'Observed', amount },
      { key: 'o5', kind: 'derived', label: 'ERP closure', status: 'Recorded' },
    );
  } else if (coverage === 'partial') {
    observedLane.push(
      {
        key: 'o3',
        kind: 'no_data',
        label: 'Bank credit',
        status: 'Awaiting bank evidence',
        caption: '0 evidence',
      },
      {
        key: 'o4',
        kind: 'no_data',
        label: 'ERP closure',
        status: 'Not requested',
        caption: '0 evidence',
      },
    );
  } else {
    observedLane.push({
      key: 'o3',
      kind: 'no_data',
      label: 'Transfer',
      status: 'Not observed',
      caption: 'evidence insufficient',
    });
  }
  return { expectedLane, observedLane };
}

function buildEvidence(summary: CaseSummary, seed: number): EvidenceRowVM[] {
  const rows: EvidenceRowVM[] = [
    {
      source: 'Payments API',
      canonicalType: 'payment.captured',
      rawType: 'payment.captured',
      eventTime: istDateTime(summary.opened_at, 12),
      amount: summary.exposure,
      authority: 'SOURCE FACT',
      authorityTone: 'source',
      detail: `ingested ${istDateTime(summary.opened_at, 13)} · INR · signature verified · duplicate: none · status: accepted`,
      reference: `ev_${hex(seed, 1)}…c4`,
    },
    {
      source: `Control ${summary.control_id}`,
      canonicalType: 'obligation.derived',
      rawType: 'n/a — derived',
      eventTime: istDateTime(summary.opened_at, 14),
      amount: summary.exposure,
      authority: 'DERIVED CONTROL',
      authorityTone: 'derived',
      detail: `ingested ${istDateTime(summary.opened_at, 15)} · INR · signature: n/a (internal) · status: accepted`,
      reference: `ev_${hex(seed, 2)}…1b`,
    },
  ];
  if (summary.contradiction_count > 0) {
    rows.push({
      source: 'Bank statement',
      canonicalType: 'bank.credit.observed',
      rawType: 'bank.credit (conflicting)',
      eventTime: istDateTime(summary.opened_at, 2880),
      amount: summary.exposure,
      authority: 'CONFLICTING',
      authorityTone: 'quarantine',
      detail: 'two credit records claim correlation · neither selected · exposure retained',
      reference: `ev_${hex(seed, 3)}…9c`,
      flag: { tone: 'quarantine', text: 'Conflicting evidence held; automatic closure blocked.' },
    });
  }
  return rows;
}

function buildRail(summary: CaseSummary, display: CaseDisplayMeta, seed: number): RailCardVM[] {
  const resolved = summary.outcome_status === 'VERIFIED' || summary.outcome_status === 'REVERSED';
  return [
    {
      key: 'plan',
      title: 'REGISTERED PLAN',
      status: 'Registered',
      tone: 'neutral',
      lines: [
        `PLAN-${summary.control_id}-REMEDIATION`,
        'version v4 · immutable',
        `hash ${hex(seed, 4)}…40aa`,
        `params amount_minor "${summary.exposure.amount_minor}" · window 24h`,
      ],
    },
    {
      key: 'policy',
      title: 'POLICY DECISION',
      status: display.policyStatus.replaceAll('_', ' '),
      tone:
        display.policyTone === 'neutral'
          ? 'info'
          : display.policyTone === 'danger'
            ? 'warning'
            : display.policyTone,
      lines: [
        `bundle policy-bundle v12 · ${hex(seed, 5)}…7d20`,
        `rule RULE-${summary.control_id}-02`,
        `reasons ${display.divergence.toLowerCase()}`,
      ],
    },
    {
      key: 'approval',
      title: 'HUMAN APPROVAL',
      status:
        summary.lifecycle_state === 'approval_required'
          ? 'REQUESTED — AWAITING DECISION'
          : resolved
            ? 'NOT REQUIRED'
            : 'NOT REQUESTED',
      tone: summary.lifecycle_state === 'approval_required' ? 'purple' : 'neutral',
      lines: ['required role Finance Approver', `basis hash ${hex(seed, 6)}…d38b (evidence set)`],
      note: 'If new evidence changes the basis hash, this approval is invalidated and must be re-requested.',
    },
    {
      key: 'action',
      title: 'SIMULATED ACTION',
      status: resolved ? 'Completed' : 'Not started',
      tone: resolved ? 'success' : 'neutral',
      lines: [
        `transfer.retry · idempotency idem_${summary.case_id.slice(-4)}_v4 · No real money movement`,
      ],
    },
    {
      key: 'verification',
      title: 'VERIFICATION EVIDENCE',
      status: resolved ? 'Verified after independent evidence' : 'Contract not run',
      tone: resolved ? 'success' : 'info',
      lines: [
        resolved
          ? 'Coverage Complete · independent bank credit + unique allocation + ERP closure. Acknowledgement alone is never sufficient.'
          : 'Coverage Partial · blockers: bank credit, ERP closure. ACK is labelled ACKNOWLEDGEMENT and is never sufficient.',
      ],
    },
    {
      key: 'reconciliation',
      title: 'RECONCILIATION',
      status: resolved ? 'Allocated' : 'Not allocated',
      tone: 'neutral',
      lines: [
        resolved
          ? `Difference ₹0.00 INR · bank evidence: present · ERP closure: recorded.`
          : `Difference ${formatMoney(summary.exposure)} · bank evidence: none · ERP closure: not requested.`,
      ],
    },
  ];
}

function buildNotes(summary: CaseSummary): OperatorNoteVM[] {
  const owner = summary.owner_id ?? 'A. Rao';
  return [
    {
      author: owner,
      authorRole: OWNER_ROLES[owner] ?? 'user_investigator',
      timestamp: `${istDateTime(summary.opened_at, 2200).replace(' IST', '')}:12 IST`,
      body: `Reviewed ${summary.case_id} under ${summary.control_id}. ${
        summary.contradiction_count > 0
          ? 'Conflicting evidence noted; requested a statement extract before any allocation.'
          : 'Awaiting the outstanding evidence before recommending a next safe action.'
      } Text is rendered verbatim — no markdown, no HTML.`,
    },
  ];
}

/** Build a complete primary workspace view model for any queue case. */
export function buildGeneratedWorkspace(
  summary: CaseSummary,
  display: CaseDisplayMeta,
): PrimaryWorkspaceVM {
  const seed = seedOf(summary.case_id);
  const { expectedLane, observedLane } = buildLanes(summary);
  const resolved = summary.outcome_status === 'VERIFIED' || summary.outcome_status === 'REVERSED';
  const exposureText = formatMoney(summary.exposure);
  return {
    kind: 'primary',
    caseId: summary.case_id,
    controlId: summary.control_id,
    controlLabel: CONTROL_LABELS[summary.control_id] ?? display.divergence.toLowerCase(),
    epoch: summary.opened_at,
    seq: 100 + (seed % 900),
    caseVersion: summary.resource_version,
    headline: `${display.divergence} · ${CONTROL_LABELS[summary.control_id] ?? summary.control_id}.`,
    materiality: materialityFor(summary.exposure),
    lifecycleLabel: lifecycleLabel(summary.lifecycle_state),
    outcomeLabel: summary.outcome_status.replaceAll('_', ' '),
    outcomeTone: outcomeToneFor(summary.outcome_status),
    evidenceCoverage: summary.evidence_coverage,
    contradictions: summary.contradiction_count,
    exposure: summary.exposure,
    openedLocal: istDateTime(summary.opened_at, 12),
    openedUtcTitle: utcTitle(summary.opened_at, 12),
    age: ageSince(summary.opened_at),
    dueLocal: summary.due_at ? istDateTime(summary.due_at) : '—',
    dueUtcTitle: summary.due_at ? utcTitle(summary.due_at) : 'no due date',
    owner: summary.owner_id,
    currentSafeAction: `${display.nextAction}. Your role can read status, run investigation, or request more evidence.`,
    expectedLane,
    observedLane,
    divergence: {
      label: `First divergence · ${display.divergence}`,
      detail: display.expected === '—' ? 'expected edge only' : `expected: ${display.expected}`,
      due: summary.due_at ? `due ${istDateTime(summary.due_at)}` : 'no due date',
    },
    investigation: {
      mode: 'deterministic-offline',
      promptVersion: 'v3.2.0',
      schemaVersion: 'v1.4.0',
      evidenceSetHash: `${hex(seed, 6)}…d38b`,
      createdLocal: '25 Aug 10:47 IST',
      confidenceBand: summary.evidence_coverage === 'complete' ? 'High' : 'Medium',
      coverageLabel:
        summary.evidence_coverage === 'complete'
          ? 'Complete (3/3)'
          : summary.evidence_coverage === 'partial'
            ? 'Partial (2/3)'
            : 'Insufficient (1/3)',
      contradictions: summary.contradiction_count,
      finding: resolved
        ? `${summary.control_id} reached a terminal outcome of ${summary.outcome_status}. Exposure of ${exposureText} was resolved against independent evidence; nothing is retained.`
        : `A captured payment created an obligation of ${exposureText}, and ${display.divergence.toLowerCase()} within the control window. The obligation remains open; exposure is retained in full.`,
      supportingEvidence: `ev_${hex(seed, 1)}… payment captured (authoritative, signature verified) · ev_${hex(seed, 2)}… obligation derived by ${summary.control_id}. Both cited in the evidence timeline below.`,
      missingEvidence:
        summary.contradiction_count > 0
          ? 'Contradiction present: two records claim correlation. Coverage cannot reach Complete until the conflict is resolved.'
          : 'Missing: independent bank credit evidence, ERP closure. Coverage cannot reach Complete until bank evidence exists.',
      recommendation: `Registered plan PLAN-${summary.control_id}-REMEDIATION v4 — ${display.nextAction.toLowerCase()}. This recommendation is not authority to act.`,
    },
    evidence: buildEvidence(summary, seed),
    rail: buildRail(summary, display, seed),
    commands: [
      ...(summary.lifecycle_state === 'approval_required'
        ? [{ label: 'Review approval', kind: 'locked' as const, note: 'Finance Approver only' }]
        : []),
      { label: 'Run investigation', kind: 'primary' as const },
      { label: 'Request more evidence', kind: 'secondary' as const },
      { label: 'Check status', kind: 'secondary' as const },
      { label: 'Add operator note', kind: 'secondary' as const },
      ...(summary.contradiction_count > 0
        ? [
            {
              label: 'Review candidate relationship',
              kind: 'secondary' as const,
              badge: String(summary.contradiction_count),
            },
          ]
        : []),
      { label: 'View audit replay', kind: 'secondary' as const },
    ],
    candidateRelationship:
      summary.contradiction_count > 0
        ? {
            sourceNode: `obligation_${summary.case_id.slice(-4)} · Obligation · ${exposureText}`,
            targetNode: `bank_credit_${hex(seed, 3)} · Bank credit · ${exposureText} · ${istDateTime(summary.opened_at, 2880)}`,
            relationship: 'settles (proposed)',
            confidence: 'candidate — amount and date match, reference differs',
            linkVersion: 1 + (seed % 4),
            evidence: `ev_${hex(seed, 3)}… (bank statement line), ev_${hex(seed, 1)}… (capture)`,
          }
        : null,
    operatorNotes: buildNotes(summary),
  };
}
