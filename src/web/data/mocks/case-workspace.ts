import type { Money } from '../../../contracts/index.js';

/**
 * Case Workspace view models (MoneyTrace Case Workspace.dc.html). These are
 * page-local view models, not the raw `ControlLoopView` API contract — the
 * workspace aggregates plan/policy/approval/action/verification/reconciliation
 * into one rail, which is exactly the kind of shaping a real adapter would do
 * once the backend is connected. Only CASE-2077 (the design's worked example)
 * gets the full three-column layout; a few other queue rows get the lighter
 * "compact" state-variant layout the design also specifies; everything else
 * in the mock queue gets a plain summary so no case link is ever a dead end.
 */

export interface MoneyPathNodeVM {
  readonly key: string;
  readonly kind:
    'expected' | 'source_fact' | 'derived' | 'simulated_action' | 'acknowledgement' | 'no_data';
  readonly label: string;
  readonly status: string;
  readonly amount?: Money;
  readonly caption?: string;
}

export interface EvidenceRowVM {
  readonly source: string;
  readonly canonicalType: string;
  readonly rawType: string;
  readonly eventTime: string;
  readonly amount?: Money;
  readonly authority: string;
  readonly authorityTone: 'source' | 'derived' | 'duplicate' | 'quarantine';
  readonly detail: string;
  readonly reference: string;
  readonly flag?: { readonly tone: 'duplicate' | 'quarantine'; readonly text: string };
}

export interface RailCardVM {
  readonly key: string;
  readonly title: string;
  readonly status: string;
  readonly tone: 'neutral' | 'success' | 'warning' | 'purple' | 'info';
  readonly lines: readonly string[];
  readonly note?: string;
}

export interface CommandVM {
  readonly label: string;
  readonly kind: 'primary' | 'secondary' | 'locked';
  readonly note?: string;
  readonly badge?: string;
}

export interface HistoryRowVM {
  readonly artifact: string;
  readonly artifactTone: 'info' | 'success' | 'neutral';
  readonly fact: string;
  readonly note?: string;
  readonly time: string;
  readonly amount: string;
  readonly negative?: boolean;
  readonly highlighted?: boolean;
}

export interface PrimaryWorkspaceVM {
  readonly kind: 'primary';
  readonly caseId: string;
  readonly controlId: string;
  readonly controlLabel: string;
  readonly epoch: string;
  readonly seq: number;
  readonly caseVersion: number;
  readonly headline: string;
  readonly materiality: string;
  readonly lifecycleLabel: string;
  readonly outcomeLabel: string;
  readonly outcomeTone: 'danger' | 'warning' | 'success' | 'slate' | 'purple';
  readonly evidenceCoverage: 'complete' | 'partial' | 'insufficient';
  readonly contradictions: number;
  readonly exposure: Money;
  readonly openedLocal: string;
  readonly openedUtcTitle: string;
  readonly age: string;
  readonly dueLocal: string;
  readonly dueUtcTitle: string;
  readonly owner: string | null;
  readonly currentSafeAction: string;
  readonly expectedLane: readonly MoneyPathNodeVM[];
  readonly observedLane: readonly MoneyPathNodeVM[];
  readonly divergence: { readonly label: string; readonly detail: string; readonly due: string };
  readonly investigation: {
    readonly mode: string;
    readonly promptVersion: string;
    readonly schemaVersion: string;
    readonly evidenceSetHash: string;
    readonly createdLocal: string;
    readonly confidenceBand: string;
    readonly coverageLabel: string;
    readonly contradictions: number;
    readonly finding: string;
    readonly supportingEvidence: string;
    readonly missingEvidence: string;
    readonly recommendation: string;
  };
  readonly evidence: readonly EvidenceRowVM[];
  readonly rail: readonly RailCardVM[];
  readonly commands: readonly CommandVM[];
  readonly candidateRelationship: CandidateRelationshipVM | null;
  readonly operatorNotes: readonly OperatorNoteVM[];
}

/** Candidate relationship review (MoneyTrace Case Workspace-selection-10.png)
 * — never rendered inside the money-path lanes; confirming it records a
 * reviewed assertion, not terminal financial authority. */
export interface CandidateRelationshipVM {
  readonly sourceNode: string;
  readonly targetNode: string;
  readonly relationship: string;
  readonly confidence: string;
  readonly linkVersion: number;
  readonly evidence: string;
}

export interface OperatorNoteVM {
  readonly author: string;
  readonly authorRole: string;
  readonly timestamp: string;
  readonly body: string;
}

export interface CompactWorkspaceVM {
  readonly kind: 'compact';
  readonly caseId: string;
  readonly lifecycleLabel: string;
  readonly outcomeLabel: string;
  readonly outcomeTone: 'danger' | 'warning' | 'success' | 'slate';
  readonly headerNote?: string;
  readonly metrics: readonly { readonly label: string; readonly value: string }[];
  readonly banner: {
    readonly tone: 'warning' | 'success' | 'danger' | 'slate';
    readonly title: string;
    readonly body: string;
  };
  readonly lane: readonly MoneyPathNodeVM[];
  readonly summaryCards: readonly {
    readonly title: string;
    readonly tone: string;
    readonly body: string;
  }[];
  /** Append-only outcome history table (reversed variant only — MoneyTrace
   * Case Workspace-selection-9.png). */
  readonly historyRows?: readonly HistoryRowVM[];
  readonly commands: readonly CommandVM[];
  readonly commandsNote: string;
}

const CASE_2077: PrimaryWorkspaceVM = {
  kind: 'primary',
  caseId: 'CASE-2077',
  controlId: 'CTL-04',
  controlLabel: 'transfer not observed at payout',
  epoch: '2026-08-25T04:10:00Z',
  seq: 118,
  caseVersion: 7,
  headline: 'Seller transfer not observed after captured payment.',
  materiality: 'Material · P1',
  lifecycleLabel: 'APPROVAL REQUIRED',
  outcomeLabel: 'DIVERGED',
  outcomeTone: 'danger',
  evidenceCoverage: 'partial',
  contradictions: 0,
  exposure: { amount_minor: '45500000', currency: 'INR' },
  openedLocal: '22 Aug, 14:20 IST',
  openedUtcTitle: '22 August 2026, 08:50:00 UTC',
  age: '3d 20h',
  dueLocal: '26 Aug, 18:00 IST',
  dueUtcTitle: '26 August 2026, 12:30:00 UTC',
  owner: null,
  currentSafeAction:
    'Review approval — requires the Finance Approver role. Your role can read status, run investigation, or request more evidence.',
  expectedLane: [
    { key: 'e1', kind: 'expected', label: 'Capture', status: 'Expected' },
    { key: 'e2', kind: 'expected', label: 'Seller obligation', status: 'Expected' },
    { key: 'e3', kind: 'expected', label: 'Transfer', status: 'Expected' },
    { key: 'e4', kind: 'expected', label: 'Recipient settlement', status: 'Expected' },
    { key: 'e5', kind: 'expected', label: 'Bank credit', status: 'Expected' },
    { key: 'e6', kind: 'expected', label: 'ERP closure', status: 'Expected' },
  ],
  observedLane: [
    {
      key: 'o1',
      kind: 'source_fact',
      label: 'Capture',
      status: 'Observed',
      amount: { amount_minor: '45500000', currency: 'INR' },
      caption: 'INR · 22 Aug 14:12 IST · payments API · 2 evidence',
    },
    {
      key: 'o2',
      kind: 'derived',
      label: 'Seller obligation',
      status: 'Observed',
      amount: { amount_minor: '45500000', currency: 'INR' },
      caption: 'INR · 22 Aug 14:13 IST · CTL-04 · 1 evidence',
    },
    {
      key: 'o3',
      kind: 'no_data',
      label: 'Recipient settlement',
      status: 'Not observed',
      caption: 'settlement is not bank evidence',
    },
    {
      key: 'o4',
      kind: 'no_data',
      label: 'Bank credit',
      status: 'Awaiting bank evidence',
      caption: '0 evidence',
    },
    {
      key: 'o5',
      kind: 'no_data',
      label: 'ERP closure',
      status: 'Not requested',
      caption: '0 evidence',
    },
  ],
  divergence: {
    label: 'First divergence · Transfer not observed',
    detail: 'expected edge only',
    due: 'due 23 Aug 18:00 IST',
  },
  investigation: {
    mode: 'deterministic-offline',
    promptVersion: 'v3.2.0',
    schemaVersion: 'v1.4.0',
    evidenceSetHash: '5c1a…d38b',
    createdLocal: '25 Aug 10:47 IST',
    confidenceBand: 'Medium',
    coverageLabel: 'Partial (2/3)',
    contradictions: 0,
    finding:
      'A captured payment created a seller obligation of ₹4,55,000.00 INR, and no transfer node was observed within the control window. The obligation remains open; exposure is retained in full.',
    supportingEvidence:
      'ev_9f12… payment captured (authoritative, signature verified) · ev_a447… obligation derived by CTL-04. Both cited in the evidence timeline below.',
    missingEvidence:
      'No contradictions. Missing: transfer record, independent bank credit evidence, ERP closure. Coverage cannot reach Complete until bank evidence exists.',
    recommendation:
      'Registered plan PLAN-TRANSFER-RETRY v4 — request human approval, then execute the simulated remediation. This recommendation is not authority to act.',
  },
  evidence: [
    {
      source: 'Payments API',
      canonicalType: 'payment.captured',
      rawType: 'payment.captured',
      eventTime: '22 Aug 14:12 IST',
      amount: { amount_minor: '45500000', currency: 'INR' },
      authority: 'SOURCE FACT',
      authorityTone: 'source',
      detail:
        'ingested 22 Aug 14:12:40 IST · INR · signature verified · duplicate: none · status: accepted',
      reference: 'ev_9f12…c4',
    },
    {
      source: 'Control CTL-04',
      canonicalType: 'obligation.derived',
      rawType: 'n/a — derived',
      eventTime: '22 Aug 14:13 IST',
      amount: { amount_minor: '45500000', currency: 'INR' },
      authority: 'DERIVED CONTROL',
      authorityTone: 'derived',
      detail:
        'ingested 22 Aug 14:13:02 IST · INR · signature: n/a (internal) · duplicate: none · status: accepted',
      reference: 'ev_a447…1b',
    },
    {
      source: 'Payments API',
      canonicalType: 'payment.captured',
      rawType: 'payment.captured (replay)',
      eventTime: '22 Aug 14:12 IST',
      amount: { amount_minor: '45500000', currency: 'INR' },
      authority: 'DUPLICATE',
      authorityTone: 'duplicate',
      detail: 'ingested 22 Aug 14:19:55 IST · idempotent digest match',
      reference: 'ev_9f12…c4',
      flag: { tone: 'duplicate', text: 'Exact replay ignored; original evidence retained.' },
    },
    {
      source: 'Payments API',
      canonicalType: 'payment.captured',
      rawType: 'payment.captured (modified)',
      eventTime: '22 Aug 14:12 IST',
      amount: { amount_minor: '49500000', currency: 'INR' },
      authority: 'QUARANTINED',
      authorityTone: 'quarantine',
      detail: 'signature mismatch · excluded from all totals',
      reference: 'ev_modified',
      flag: {
        tone: 'quarantine',
        text: 'Modified duplicate quarantined; authoritative state not overwritten.',
      },
    },
  ],
  rail: [
    {
      key: 'plan',
      title: 'REGISTERED PLAN',
      status: 'Registered',
      tone: 'neutral',
      lines: [
        'PLAN-TRANSFER-RETRY',
        'version v4 · immutable',
        'hash 9b7e…40aa',
        'params amount_minor "45500000" · dest seller_acct_7741 · window 24h',
      ],
    },
    {
      key: 'policy',
      title: 'POLICY DECISION',
      status: 'ALLOW WITH APPROVAL',
      tone: 'success',
      lines: [
        'bundle policy-bundle v12 · c31f…7d20',
        'rule RULE-TRANSFER-REMEDIATION-02',
        'reasons material exposure · single obligation · no contradiction',
        'default deny (not applied — rule matched)',
      ],
    },
    {
      key: 'approval',
      title: 'HUMAN APPROVAL',
      status: 'REQUESTED — AWAITING DECISION',
      tone: 'purple',
      lines: [
        'required role Finance Approver',
        'requester user_investigator · 25 Aug 10:52 IST',
        'approver — not yet decided',
        'expires 26 Aug 10:52 IST',
        'basis hash 5c1a…d38b (evidence set)',
      ],
      note: 'If new evidence changes the basis hash, this approval is invalidated and must be re-requested.',
    },
    {
      key: 'action',
      title: 'SIMULATED ACTION',
      status: 'Not started',
      tone: 'neutral',
      lines: ['transfer.retry · idempotency idem_2077_v4_01 · attempt 0 · No real money movement'],
    },
    {
      key: 'verification',
      title: 'VERIFICATION EVIDENCE',
      status: 'Contract not run',
      tone: 'info',
      lines: [
        'Coverage Partial · blockers: transfer record, bank credit, ERP closure. ACK, when it arrives, is labelled ACKNOWLEDGEMENT and is never sufficient.',
      ],
    },
    {
      key: 'reconciliation',
      title: 'RECONCILIATION',
      status: 'Not allocated',
      tone: 'neutral',
      lines: [
        'Difference ₹4,55,000.00 INR · bank evidence: none · ERP closure: not requested · no reversal recorded.',
      ],
    },
  ],
  commands: [
    { label: 'Review approval', kind: 'locked', note: 'Finance Approver only' },
    { label: 'Run investigation', kind: 'primary' },
    { label: 'Request more evidence', kind: 'secondary' },
    { label: 'Check status', kind: 'secondary' },
    { label: 'Add operator note', kind: 'secondary' },
    { label: 'Review candidate relationship', kind: 'secondary', badge: '1' },
    { label: 'View audit replay', kind: 'secondary' },
  ],
  candidateRelationship: {
    sourceNode: 'obligation_2077 · Seller obligation · ₹4,55,000.00 INR',
    targetNode: 'bank_credit_d18f · Bank credit · ₹4,55,000.00 INR · 24 Aug 09:14 IST',
    relationship: 'settles (proposed)',
    confidence: 'candidate — amount and date match, reference differs',
    linkVersion: 3,
    evidence: 'ev_d18f…9c (bank statement line), ev_9f12…c4 (capture)',
  },
  operatorNotes: [
    {
      author: 'A. Rao',
      authorRole: 'user_investigator',
      timestamp: '25 Aug 2026, 10:58:12 IST',
      body: 'Called the settlement desk; they see no transfer instruction for this obligation. Asked for a statement extract covering 22–24 Aug. Text is rendered verbatim — no markdown, no HTML.',
    },
    {
      author: 'S. Menon',
      authorRole: 'user_approver',
      timestamp: '25 Aug 2026, 11:02:40 IST',
      body: 'Will not approve remediation until the statement extract is attached as evidence.',
    },
  ],
};

const CASE_2018: CompactWorkspaceVM = {
  kind: 'compact',
  caseId: 'CASE-2018',
  lifecycleLabel: 'OPEN',
  outcomeLabel: 'UNRESOLVED',
  outcomeTone: 'danger',
  headerNote: 'Contradictions · 2',
  metrics: [{ label: 'EXPOSURE RETAINED', value: '₹1,60,000.00 INR' }],
  banner: {
    tone: 'danger',
    title: 'Conflicting evidence — automatic closure blocked.',
    body: 'Two bank credit records each claim correlation to this obligation. Neither is selected, neither is discarded, and no allocation is made. Exposure remains at full value until a human review or further evidence resolves the ambiguity.',
  },
  lane: [
    {
      key: 'c1',
      kind: 'source_fact',
      label: 'Capture',
      status: 'Observed',
      amount: { amount_minor: '16000000', currency: 'INR' },
    },
    {
      key: 'c2',
      kind: 'derived',
      label: 'Seller obligation',
      status: 'Observed',
      amount: { amount_minor: '16000000', currency: 'INR' },
    },
  ],
  summaryCards: [
    {
      title: 'AMBIGUITY AREA — NOT PART OF THE VERIFIED PATH',
      tone: 'purple',
      body: 'Candidate bank credit A (24 Aug 09:14 IST, ₹1,60,000.00, amount+date match, ref differs, ev_d18f…) and candidate bank credit B (24 Aug 17:41 IST, ₹1,60,000.00, reference match, date differs, ev_77b3…). Both remain candidates — neither is drawn into the lane, neither is preferred, and no allocation, verification or closure is derived from either.',
    },
    {
      title: 'CONTRADICTIONS',
      tone: 'warning',
      body: '(1) two credits claim the same obligation · (2) one credit’s reference contradicts the transfer reference. Both are listed as separate evidence rows and neither is suppressed.',
    },
  ],
  commands: [
    { label: 'Request more evidence', kind: 'primary' },
    { label: 'Review candidate relationship', kind: 'secondary' },
    { label: 'Add operator note', kind: 'secondary' },
    { label: 'View audit replay', kind: 'secondary' },
  ],
  commandsNote: 'RECONCILIATION_AMBIGUOUS · no execution command offered',
};

const CASE_2054: CompactWorkspaceVM = {
  kind: 'compact',
  caseId: 'CASE-2054',
  lifecycleLabel: 'RECONCILED',
  outcomeLabel: 'VERIFIED',
  outcomeTone: 'success',
  metrics: [
    { label: 'REMAINING EXPOSURE', value: '₹0.00 INR' },
    { label: 'VERIFIED RESTORED', value: '₹80,000.00 INR' },
  ],
  banner: {
    tone: 'success',
    title: 'Verified only after all required independent evidence.',
    body: 'Verification was produced by the verification contract after independent bank credit evidence, a unique allocation with no double counting, and an observed ERP closure. The earlier Route acknowledgement is recorded in the timeline and contributed nothing to this verification.',
  },
  lane: [
    {
      key: 'v1',
      kind: 'source_fact',
      label: 'Capture',
      status: 'Observed',
      amount: { amount_minor: '8000000', currency: 'INR' },
    },
    {
      key: 'v2',
      kind: 'derived',
      label: 'Seller obligation',
      status: 'Observed',
      amount: { amount_minor: '8000000', currency: 'INR' },
    },
    {
      key: 'v3',
      kind: 'source_fact',
      label: 'Transfer',
      status: 'Observed',
      amount: { amount_minor: '8000000', currency: 'INR' },
    },
    {
      key: 'v4',
      kind: 'acknowledgement',
      label: 'Recipient settlement',
      status: 'Observed — not bank evidence',
    },
    {
      key: 'v5',
      kind: 'source_fact',
      label: 'Bank credit',
      status: 'Independent evidence',
      amount: { amount_minor: '8000000', currency: 'INR' },
    },
    { key: 'v6', kind: 'derived', label: 'ERP closure', status: 'Observed' },
  ],
  summaryCards: [
    {
      title: 'VERIFICATION EVIDENCE',
      tone: 'info',
      body: 'Contract passed · coverage Complete (3/3) · blockers none. Cited: bank credit ev_b74c… (independent, signature verified), allocation alloc_4471, ERP closure ev_e901…. ACK ev_c210… listed separately as ACKNOWLEDGEMENT — not counted.',
    },
    {
      title: 'RECONCILIATION',
      tone: 'success',
      body: 'Allocation unique — one bank credit to one obligation, no double count. Difference ₹0.00 INR. ERP closure requested, then observed. No reversal recorded.',
    },
  ],
  commands: [
    { label: 'View audit replay', kind: 'secondary' },
    { label: 'Add operator note', kind: 'secondary' },
  ],
  commandsNote: 'no execution commands returned — the loop is closed',
};

const CASE_2090: CompactWorkspaceVM = {
  kind: 'compact',
  caseId: 'CASE-2090',
  lifecycleLabel: 'RECONCILED',
  outcomeLabel: 'REVERSED',
  outcomeTone: 'slate',
  headerNote: 'Reversed after refund',
  metrics: [
    { label: 'RETAINED VALUE NOW', value: '₹0.00 INR' },
    { label: 'VERIFIED RESTORED', value: '₹0.00 INR' },
  ],
  banner: {
    tone: 'slate',
    title: 'Reversed after refund. The earlier verification is not deleted.',
    body: 'A ₹1,20,000.00 INR recovery was verified on 24 Aug. An authoritative refund correlated to that recovery arrived on 25 Aug, so retained value returned to ₹0.00 INR. The verified record stays in the timeline as a completed historical fact with its own timestamps; the reversal is appended after it. This case cannot return directly to VERIFIED — a new recovery would need its own independent evidence.',
  },
  lane: [],
  summaryCards: [],
  historyRows: [
    {
      artifact: 'VERIFICATION EV.',
      artifactTone: 'info',
      fact: 'Independent bank credit received; unique allocation recorded',
      time: '24 Aug 15:02 IST',
      amount: '₹1,20,000.00',
    },
    {
      artifact: 'RECONCILIATION',
      artifactTone: 'success',
      fact: 'ERP closure observed · outcome recorded as VERIFIED',
      note: '(historical — still true of that moment)',
      time: '24 Aug 15:20 IST',
      amount: '₹1,20,000.00',
    },
    {
      artifact: 'SOURCE FACT',
      artifactTone: 'neutral',
      fact: 'Authoritative refund correlated to the recovery payment',
      time: '25 Aug 09:41 IST',
      amount: '−₹1,20,000.00',
      negative: true,
    },
    {
      artifact: 'RECONCILIATION',
      artifactTone: 'neutral',
      fact: 'Reversal recorded · outcome now REVERSED · retained value ₹0.00 INR',
      time: '25 Aug 09:47 IST',
      amount: '₹0.00',
      highlighted: true,
    },
  ],
  commands: [
    { label: 'View audit replay', kind: 'primary' },
    { label: 'Request more evidence', kind: 'secondary' },
    { label: 'Add operator note', kind: 'secondary' },
  ],
  commandsNote: 'history is append-only · nothing is edited or removed',
};

export const PRIMARY_WORKSPACES: Readonly<Record<string, PrimaryWorkspaceVM>> = {
  'CASE-2077': CASE_2077,
};

export const COMPACT_WORKSPACES: Readonly<Record<string, CompactWorkspaceVM>> = {
  'CASE-2018': CASE_2018,
  'CASE-2054': CASE_2054,
  'CASE-2090': CASE_2090,
};
