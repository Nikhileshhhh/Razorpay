import type { ArtifactType, CaseSummary, Money } from '../../../contracts/index.js';
import type { CaseDisplayMeta } from './cases.js';
import { mockHash } from './support.js';

/**
 * Audit Replay mock for CASE-2077 (MoneyTrace Audit Replay.dc.html — frames
 * 1a–1c). A page-local view model: real audit rows are references only
 * (artifact_id/hash/actor), so the per-category "card template" content
 * (what happened, in which fields) is resolved server-side by joining the
 * referenced artifact — reproduced here directly, reusing the same case
 * facts (amounts, hashes, idempotency key) established in the Approvals mock
 * for CASE-2077 / APR-4471.
 */

export type AuditCategoryKey =
  | 'source-facts'
  | 'derived-controls'
  | 'investigation'
  | 'policy'
  | 'human-approval'
  | 'simulated-action'
  | 'verification'
  | 'reversal-admin-demo';

export interface AuditCategoryDef {
  readonly key: AuditCategoryKey;
  readonly label: string;
  readonly types: readonly ArtifactType[];
}

export const AUDIT_CATEGORIES: readonly AuditCategoryDef[] = [
  { key: 'source-facts', label: 'Source facts', types: ['EVIDENCE'] },
  { key: 'derived-controls', label: 'Derived controls', types: ['CASE_TRANSITION', 'MANUAL_LINK'] },
  {
    key: 'investigation',
    label: 'Investigation',
    types: ['INVESTIGATION', 'FINDING', 'AGENT_CLAIM', 'CLAIM_EVALUATION'],
  },
  { key: 'policy', label: 'Policy', types: ['POLICY_DECISION'] },
  { key: 'human-approval', label: 'Human approval', types: ['APPROVAL'] },
  { key: 'simulated-action', label: 'Simulated action', types: ['ACTION'] },
  {
    key: 'verification',
    label: 'Verification / reconciliation',
    types: ['VERIFICATION', 'RECONCILIATION', 'RECEIVABLE_CLOSURE'],
  },
  {
    key: 'reversal-admin-demo',
    label: 'Reversal / admin / demo',
    types: ['RECONCILIATION_REVERSAL', 'ADMIN_CHANGE', 'DATASET_IMPORT', 'DEMO_COMMAND'],
  },
];

export function categoryForType(type: ArtifactType): AuditCategoryDef {
  return AUDIT_CATEGORIES.find((category) => category.types.includes(type)) ?? AUDIT_CATEGORIES[0]!;
}

/**
 * The eight card-template names ("source facts lead with event type and
 * amount; investigation with mode, prompt and schema versions... "),
 * distinct from the category label — verification and reconciliation share
 * one filter category but render as two separate templates.
 */
const CARD_TEMPLATE_LABEL: Readonly<Record<ArtifactType, string>> = {
  EVIDENCE: 'Evidence',
  CASE_TRANSITION: 'Case control',
  MANUAL_LINK: 'Case control',
  INVESTIGATION: 'Investigation',
  FINDING: 'Investigation',
  AGENT_CLAIM: 'Investigation',
  CLAIM_EVALUATION: 'Investigation',
  POLICY_DECISION: 'Policy',
  APPROVAL: 'Approval',
  ACTION: 'Action',
  VERIFICATION: 'Verification',
  RECONCILIATION: 'Reconciliation',
  RECEIVABLE_CLOSURE: 'Reconciliation',
  RECONCILIATION_REVERSAL: 'Administrative',
  ADMIN_CHANGE: 'Administrative',
  DATASET_IMPORT: 'Administrative',
  DEMO_COMMAND: 'Administrative',
};

export function cardTemplateLabel(type: ArtifactType): string {
  return CARD_TEMPLATE_LABEL[type];
}

export interface HashPair {
  readonly short: string;
  readonly full: string;
}

export interface CoverageVM {
  readonly label: 'Complete' | 'Partial' | 'None';
  readonly done: number;
  readonly total: number;
}

export type DetailField =
  | {
      readonly kind: 'text';
      readonly label: string;
      readonly text: string;
      readonly mono?: boolean;
      readonly strong?: boolean;
      readonly tone?: 'success' | 'warning' | 'danger';
    }
  | {
      readonly kind: 'money';
      readonly label: string;
      readonly money: Money;
      readonly tone?: 'success' | 'warning' | 'danger';
    }
  | { readonly kind: 'coverage'; readonly label: string; readonly coverage: CoverageVM }
  | { readonly kind: 'notRecorded'; readonly label: string };

export interface RelatedArtifactRef {
  readonly sequence: number | null;
  readonly typeLabel: string;
  readonly text: string;
  readonly toSequence?: number;
  readonly toCase?: string;
}

export interface AuditRowVM {
  readonly sequence: number;
  readonly artifactId: string;
  readonly artifactType: ArtifactType;
  readonly kindLabel: string;
  readonly title: string;
  readonly rowSummary: string;
  readonly actor: string;
  readonly createdLocalShort: string;
  readonly createdLocalFull: string;
  readonly createdUtc: string;
  readonly outcome?: { readonly label: string; readonly tone: 'success' | 'warning' | 'danger' };
  readonly explanation: string;
  readonly fields: readonly DetailField[];
  readonly related: readonly RelatedArtifactRef[];
  readonly metadata: {
    readonly identityActor: string;
    readonly identitySub: string | null;
    readonly actorRole: string;
    readonly schemaVersion: string;
    readonly contractVersion: string | null;
    readonly resourceVersion: string | null;
    readonly policyVersion: string | null;
    readonly promptModelVersion: string | null;
    readonly artifactHash: HashPair;
    readonly evidenceSetHash: HashPair | null;
    readonly requestId: string | null;
    readonly correlationId: string | null;
  };
}

const CASE_ID = 'CASE-2077';
const AMOUNT: Money = { amount_minor: '45500000', currency: 'INR' };
const EVIDENCE_HASH: HashPair = { short: '5c1a…d38b', full: '5c1ad38b7742e0091fbc3a5d6e8471c2' };
const BASIS_HASH: HashPair = { short: 'a17f…14c3', full: 'a17f92bc4408d31e77052fa6bb9e14c3' };

function auditId(sequence: number): string {
  return `aud_2077_${sequence.toString().padStart(4, '0')}`;
}

function hashFor(prefix: string, suffix: string): HashPair {
  const full = mockHash(prefix, suffix).replace('sha256:', '');
  return { short: `${prefix}…${suffix}`, full };
}

export const CASE_2077_AUDIT: readonly AuditRowVM[] = [
  {
    sequence: 12,
    artifactId: auditId(12),
    artifactType: 'EVIDENCE',
    kindLabel: 'SOURCE EVIDENCE',
    title: 'Payment captured',
    rowSummary: 'Payment captured',
    actor: 'Synthetic Payments',
    createdLocalShort: '22 Aug 14:12 IST',
    createdLocalFull: '22 Aug 2026, 14:12:00 IST',
    createdUtc: '2026-08-22T08:42:00Z',
    explanation:
      'A captured payment event was recorded for this case’s economic subject. A captured payment is a source fact; it does not by itself establish that the funds were retained.',
    fields: [
      { kind: 'text', label: 'Event type', text: 'payment.captured', mono: true, strong: true },
      { kind: 'money', label: 'Amount', money: AMOUNT },
      { kind: 'text', label: 'Source system', text: 'Synthetic Payments', mono: true },
      { kind: 'text', label: 'Reference', text: 'pay_c210_7f41', mono: true },
    ],
    related: [
      { sequence: null, typeLabel: 'CASE', text: `${CASE_ID} · Seller transfer not observed` },
    ],
    metadata: {
      identityActor: 'Synthetic Payments connector',
      identitySub: 'svc_payments_ingest',
      actorRole: 'system · source connector',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: null,
      resourceVersion: 'case v1',
      policyVersion: null,
      promptModelVersion: null,
      artifactHash: hashFor('4a10', 'e832'),
      evidenceSetHash: null,
      requestId: 'req_2b7f9c14',
      correlationId: 'corr_2077_v1_01',
    },
  },
  {
    sequence: 13,
    artifactId: auditId(13),
    artifactType: 'CASE_TRANSITION',
    kindLabel: 'CASE CONTROL',
    title: 'Case opened by CTL-04',
    rowSummary: 'Case opened by CTL-04',
    actor: 'MoneyTrace · system',
    createdLocalShort: '22 Aug 14:13 IST',
    createdLocalFull: '22 Aug 2026, 14:13:00 IST',
    createdUtc: '2026-08-22T08:43:00Z',
    outcome: { label: 'Candidate → open', tone: 'success' },
    explanation:
      'The deterministic matcher opened this case after control CTL-04 (captured payment without observed transfer) fired against the sealed evidence set at the time.',
    fields: [
      { kind: 'text', label: 'From state', text: 'candidate', mono: true },
      { kind: 'text', label: 'To state', text: 'open', mono: true, strong: true },
      {
        kind: 'text',
        label: 'Control / divergence',
        text: 'CTL-04 · captured payment without observed transfer',
      },
      { kind: 'text', label: 'Triggered by', text: 'MoneyTrace · system', mono: true },
    ],
    related: [
      { sequence: 12, typeLabel: 'EVIDENCE', text: 'Payment captured', toSequence: 12 },
      { sequence: null, typeLabel: 'CASE', text: `${CASE_ID} · Seller transfer not observed` },
    ],
    metadata: {
      identityActor: 'MoneyTrace matcher',
      identitySub: 'svc_matcher',
      actorRole: 'system · deterministic matcher',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: null,
      resourceVersion: 'case v1',
      policyVersion: null,
      promptModelVersion: null,
      artifactHash: hashFor('9a01', '3f4d'),
      evidenceSetHash: null,
      requestId: 'req_7d3a48e0',
      correlationId: 'corr_2077_v1_02',
    },
  },
  {
    sequence: 19,
    artifactId: auditId(19),
    artifactType: 'INVESTIGATION',
    kindLabel: 'INVESTIGATION RECORD',
    title: 'Offline analysis run',
    rowSummary: 'Offline analysis run',
    actor: 'user_investigator',
    createdLocalShort: '25 Aug 10:47 IST',
    createdLocalFull: '25 Aug 2026, 10:47:00 IST',
    createdUtc: '2026-08-25T05:17:00Z',
    explanation:
      'An offline analysis pass was run over the sealed evidence set for this case. The run is a record of the attempt; it carries no safe-to-act verdict on its own.',
    fields: [
      { kind: 'text', label: 'Mode', text: 'offline', mono: true },
      { kind: 'text', label: 'Prompt version', text: 'prompt.v3.2', mono: true },
      { kind: 'text', label: 'Schema version', text: 'audit.v1.4.0', mono: true },
      { kind: 'text', label: 'Safe-to-act verdict', text: 'Not yet determined', tone: 'warning' },
    ],
    related: [
      { sequence: null, typeLabel: 'CASE', text: `${CASE_ID} · Seller transfer not observed` },
    ],
    metadata: {
      identityActor: 'A. Rao',
      identitySub: 'user_investigator',
      actorRole: 'human · investigator',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: null,
      resourceVersion: 'case v5',
      policyVersion: null,
      promptModelVersion: 'prompt.v3.2',
      artifactHash: hashFor('6e2c', '0a91'),
      evidenceSetHash: EVIDENCE_HASH,
      requestId: 'req_44c8a219',
      correlationId: 'corr_2077_v4_01',
    },
  },
  {
    sequence: 20,
    artifactId: auditId(20),
    artifactType: 'FINDING',
    kindLabel: 'INVESTIGATION RECORD',
    title: 'Finding recorded — transfer not observed',
    rowSummary: 'Finding recorded — transfer not observed',
    actor: 'MoneyTrace · offline model',
    createdLocalShort: '25 Aug 10:47 IST',
    createdLocalFull: '25 Aug 2026, 10:47:00 IST',
    createdUtc: '2026-08-25T05:17:00Z',
    outcome: { label: 'Escalate for remediation', tone: 'warning' },
    explanation:
      'The offline analysis run concluded with a finding: the seller transfer expected after the captured payment was never observed in the sealed evidence set.',
    fields: [
      { kind: 'text', label: 'Mode', text: 'offline', mono: true },
      { kind: 'text', label: 'Schema version', text: 'audit.v1.4.0', mono: true },
      {
        kind: 'text',
        label: 'Finding',
        text: 'MISSING_EXPECTED_TRANSFER',
        mono: true,
        strong: true,
      },
      {
        kind: 'text',
        label: 'Safe-to-act verdict',
        text: 'Escalate for remediation',
        tone: 'warning',
      },
    ],
    related: [
      { sequence: 19, typeLabel: 'INVESTIGATION', text: 'Offline analysis run', toSequence: 19 },
      { sequence: null, typeLabel: 'CASE', text: `${CASE_ID} · Seller transfer not observed` },
    ],
    metadata: {
      identityActor: 'MoneyTrace offline model',
      identitySub: 'svc_offline_model',
      actorRole: 'system · offline analysis',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: null,
      resourceVersion: 'case v5',
      policyVersion: null,
      promptModelVersion: 'prompt.v3.2',
      artifactHash: hashFor('2b7c', '88ae'),
      evidenceSetHash: EVIDENCE_HASH,
      requestId: 'req_9a1e77c2',
      correlationId: 'corr_2077_v4_01',
    },
  },
  {
    sequence: 22,
    artifactId: auditId(22),
    artifactType: 'AGENT_CLAIM',
    kindLabel: 'AGENT CLAIM',
    title: 'Untrusted recovery claim received',
    rowSummary: 'Untrusted recovery claim received',
    actor: 'agent_demo_01',
    createdLocalShort: '25 Aug 10:49 IST',
    createdLocalFull: '25 Aug 2026, 10:49:00 IST',
    createdUtc: '2026-08-25T05:19:00Z',
    outcome: { label: 'Untrusted — not verified', tone: 'warning' },
    explanation:
      'A synthetic agent reported a recovery for this case. The claim and its linked payment are inputs, not conclusions; they do not establish that value was retained.',
    fields: [
      { kind: 'money', label: 'Claimed amount', money: AMOUNT },
      {
        kind: 'text',
        label: 'Recovery payment observed',
        text: 'Yes — linked captured payment evidence',
        strong: true,
      },
      { kind: 'text', label: 'Source', text: 'agent_demo_01 (untrusted)', mono: true },
    ],
    related: [
      { sequence: 12, typeLabel: 'EVIDENCE', text: 'Payment captured', toSequence: 12 },
      { sequence: null, typeLabel: 'CASE', text: `${CASE_ID} · Seller transfer not observed` },
    ],
    metadata: {
      identityActor: 'Synthetic demo agent',
      identitySub: 'agent_demo_01',
      actorRole: 'agent · untrusted claimant',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: null,
      resourceVersion: 'case v5',
      policyVersion: null,
      promptModelVersion: null,
      artifactHash: hashFor('88d4', 'f102'),
      evidenceSetHash: EVIDENCE_HASH,
      requestId: 'req_c15e3b90',
      correlationId: 'corr_2077_v4_01',
    },
  },
  {
    sequence: 23,
    artifactId: auditId(23),
    artifactType: 'CLAIM_EVALUATION',
    kindLabel: 'INVESTIGATION RECORD',
    title: 'Claim evaluated — not verified',
    rowSummary: 'Claim evaluated — not verified',
    actor: 'MoneyTrace · system',
    createdLocalShort: '25 Aug 10:50 IST',
    createdLocalFull: '25 Aug 2026, 10:50:00 IST',
    createdUtc: '2026-08-25T05:20:00Z',
    outcome: { label: 'Not verified', tone: 'warning' },
    explanation:
      'The deterministic pipeline evaluated the agent claim at sequence #22 against the independent-evidence baseline. Independent evidence had not yet been received.',
    fields: [
      {
        kind: 'text',
        label: 'Evaluation result',
        text: 'Not verified',
        tone: 'warning',
        strong: true,
      },
      {
        kind: 'text',
        label: 'Reason',
        text: 'independent evidence not yet received',
      },
      { kind: 'text', label: 'Linked claim', text: auditId(22), mono: true },
    ],
    related: [
      {
        sequence: 22,
        typeLabel: 'AGENT_CLAIM',
        text: 'Untrusted recovery claim received',
        toSequence: 22,
      },
      { sequence: null, typeLabel: 'CASE', text: `${CASE_ID} · Seller transfer not observed` },
    ],
    metadata: {
      identityActor: 'MoneyTrace claim evaluator',
      identitySub: 'svc_claim_eval',
      actorRole: 'system · claim evaluator',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: 'VC-TRANSFER-RESTORE v1.4.0',
      resourceVersion: 'case v5',
      policyVersion: null,
      promptModelVersion: null,
      artifactHash: hashFor('d40b', '77c1'),
      evidenceSetHash: EVIDENCE_HASH,
      requestId: 'req_5f2b81aa',
      correlationId: 'corr_2077_v4_01',
    },
  },
  {
    sequence: 25,
    artifactId: auditId(25),
    artifactType: 'POLICY_DECISION',
    kindLabel: 'POLICY DECISION',
    title: 'Allow with approval',
    rowSummary: 'Allow with approval',
    actor: 'MoneyTrace · policy engine',
    createdLocalShort: '25 Aug 10:51 IST',
    createdLocalFull: '25 Aug 2026, 10:51:00 IST',
    createdUtc: '2026-08-25T05:21:00Z',
    outcome: { label: 'Allow with approval', tone: 'success' },
    explanation:
      'The policy engine evaluated the finding at sequence #20 against the current policy bundle and matched a remediation rule requiring human approval before any simulated action.',
    fields: [
      { kind: 'text', label: 'Policy bundle version', text: 'v12 · c31f…7d20', mono: true },
      {
        kind: 'text',
        label: 'Decision',
        text: 'POL-DEC-88214 · ALLOW WITH APPROVAL',
        mono: true,
        strong: true,
        tone: 'success',
      },
      {
        kind: 'text',
        label: 'Matched rules',
        text: 'RULE-TRANSFER-REMEDIATION-02 — material exposure, single obligation, no contradiction',
      },
    ],
    related: [
      {
        sequence: 20,
        typeLabel: 'FINDING',
        text: 'Finding recorded — transfer not observed',
        toSequence: 20,
      },
      { sequence: null, typeLabel: 'CASE', text: `${CASE_ID} · Seller transfer not observed` },
    ],
    metadata: {
      identityActor: 'MoneyTrace policy engine',
      identitySub: 'svc_policy',
      actorRole: 'system · policy engine',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: null,
      resourceVersion: 'case v5 · policy v12',
      policyVersion: 'policy-bundle v12',
      promptModelVersion: null,
      artifactHash: hashFor('c31f', '7d20'),
      evidenceSetHash: EVIDENCE_HASH,
      requestId: 'req_a80fd612',
      correlationId: 'corr_2077_v4_01',
    },
  },
  {
    sequence: 27,
    artifactId: auditId(27),
    artifactType: 'APPROVAL',
    kindLabel: 'HUMAN APPROVAL',
    title: 'Approval recorded — APR-4471',
    rowSummary: 'Approval recorded — APR-4471',
    actor: 'user_approver',
    createdLocalShort: '25 Aug 11:04 IST',
    createdLocalFull: '25 Aug 2026, 11:04:18 IST',
    createdUtc: '2026-08-25T05:34:18Z',
    outcome: { label: 'Approved', tone: 'success' },
    explanation:
      'A Finance Approver approved the simulated remediation against the immutable decision basis. This records a HUMAN APPROVAL artifact; no money moves as a result.',
    fields: [
      { kind: 'text', label: 'Requester', text: 'A. Rao · user_investigator' },
      { kind: 'text', label: 'Approver', text: 'S. Menon · user_approver' },
      { kind: 'text', label: 'Decision', text: 'APPROVED', tone: 'success', strong: true },
      { kind: 'text', label: 'Expiry', text: '26 Aug 2026, 10:52 IST (05:22:00 UTC)' },
      { kind: 'text', label: 'Basis hash', text: BASIS_HASH.short, mono: true },
    ],
    related: [
      { sequence: 25, typeLabel: 'POLICY_DECISION', text: 'Allow with approval', toSequence: 25 },
      { sequence: null, typeLabel: 'CASE', text: `${CASE_ID} · Seller transfer not observed` },
    ],
    metadata: {
      identityActor: 'S. Menon',
      identitySub: 'user_approver',
      actorRole: 'human · finance approver',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: null,
      resourceVersion: 'case v7',
      policyVersion: 'policy-bundle v12',
      promptModelVersion: null,
      artifactHash: hashFor('5c1a', 'd38b'),
      evidenceSetHash: EVIDENCE_HASH,
      requestId: 'req_9f4b21c7',
      correlationId: 'corr_2077_v4_01',
    },
  },
  {
    sequence: 28,
    artifactId: auditId(28),
    artifactType: 'ACTION',
    kindLabel: 'SIMULATED ACTION',
    title: 'Simulated transfer.retry submitted',
    rowSummary: 'Simulated transfer.retry submitted',
    actor: 'Synthetic Route',
    createdLocalShort: '25 Aug 11:03 IST',
    createdLocalFull: '25 Aug 2026, 11:03:00 IST',
    createdUtc: '2026-08-25T05:33:00Z',
    outcome: { label: 'Submitted — no real money movement', tone: 'warning' },
    explanation:
      'The executor submitted the approved transfer.retry action against the synthetic Route connector. This is a simulated action; it never moves real money.',
    fields: [
      { kind: 'text', label: 'Action type', text: 'transfer.retry', mono: true, strong: true },
      { kind: 'text', label: 'Status', text: 'submitted', mono: true },
      { kind: 'text', label: 'Idempotency key', text: 'idem_2077_v4_01', mono: true },
      { kind: 'text', label: 'Synthetic external ref', text: 'ext_route_889201', mono: true },
      { kind: 'text', label: 'Effect', text: 'No real money movement', tone: 'warning' },
    ],
    related: [
      { sequence: 27, typeLabel: 'APPROVAL', text: 'Approval recorded — APR-4471', toSequence: 27 },
      { sequence: null, typeLabel: 'CASE', text: `${CASE_ID} · Seller transfer not observed` },
    ],
    metadata: {
      identityActor: 'MoneyTrace executor',
      identitySub: 'svc_executor',
      actorRole: 'system · action executor',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: null,
      resourceVersion: 'case v7 · plan v4',
      policyVersion: 'policy-bundle v12',
      promptModelVersion: null,
      artifactHash: hashFor('7f21', 'c9a0'),
      evidenceSetHash: EVIDENCE_HASH,
      requestId: 'req_3c9de401',
      correlationId: 'corr_2077_v4_01',
    },
  },
  {
    sequence: 30,
    artifactId: auditId(30),
    artifactType: 'EVIDENCE',
    kindLabel: 'SOURCE EVIDENCE',
    title: 'Independent bank credit observed',
    rowSummary: 'Independent bank credit observed',
    actor: 'Synthetic Bank',
    createdLocalShort: '25 Aug 11:18 IST',
    createdLocalFull: '25 Aug 2026, 11:18:00 IST',
    createdUtc: '2026-08-25T05:48:00Z',
    explanation:
      'An independent bank credit was observed for this case’s economic subject, sourced directly from the synthetic bank connector rather than from the agent claim.',
    fields: [
      { kind: 'text', label: 'Event type', text: 'bank.credit_observed', mono: true, strong: true },
      { kind: 'money', label: 'Amount', money: AMOUNT },
      { kind: 'text', label: 'Source system', text: 'Synthetic Bank', mono: true },
      { kind: 'text', label: 'Reference', text: 'ev_b74c…08', mono: true },
    ],
    related: [
      { sequence: null, typeLabel: 'CASE', text: `${CASE_ID} · Seller transfer not observed` },
    ],
    metadata: {
      identityActor: 'Synthetic Bank connector',
      identitySub: 'svc_bank_ingest',
      actorRole: 'system · source connector',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: null,
      resourceVersion: 'case v7',
      policyVersion: null,
      promptModelVersion: null,
      artifactHash: hashFor('b74c', '0833'),
      evidenceSetHash: null,
      requestId: 'req_60a1de4f',
      correlationId: 'corr_2077_v4_01',
    },
  },
  {
    sequence: 31,
    artifactId: 'aud_2077_0031',
    artifactType: 'VERIFICATION',
    kindLabel: 'VERIFICATION EVIDENCE',
    title: 'Verification contract run — passed',
    rowSummary: 'Verification contract run — passed',
    actor: 'MoneyTrace',
    createdLocalShort: '25 Aug 11:31 IST',
    createdLocalFull: '25 Aug 2026, 11:31:06 IST',
    createdUtc: '2026-08-25T06:01:06Z',
    outcome: { label: 'VERIFIED', tone: 'success' },
    explanation:
      'The verification contract evaluated the sealed evidence set and passed: independent bank credit matched at #30, unique allocation recorded at #32, ERP closure observed at #34. The Route acknowledgement at #29 was read as an acknowledgement and contributed nothing to this result.',
    fields: [
      {
        kind: 'text',
        label: 'Contract / run',
        text: 'VC-TRANSFER-RESTORE v1.4.0 · run version 5',
        mono: true,
        strong: true,
      },
      {
        kind: 'coverage',
        label: 'Evidence coverage',
        coverage: { label: 'Complete', done: 3, total: 3 },
      },
      { kind: 'text', label: 'Blockers', text: '0 · none recorded', tone: 'success', strong: true },
      {
        kind: 'text',
        label: 'Result',
        text: 'VERIFIED — after independent evidence',
        tone: 'success',
        strong: true,
      },
      { kind: 'money', label: 'Verified amount', money: AMOUNT },
      {
        kind: 'text',
        label: 'Source value',
        text: 'verified_minor "45500000" · formatted with BigInt only',
        mono: true,
      },
    ],
    related: [
      {
        sequence: 30,
        typeLabel: 'EVIDENCE',
        text: 'Independent bank credit observed · ev_b74c…08',
        toSequence: 30,
      },
      {
        sequence: 32,
        typeLabel: 'RECONCILIATION',
        text: 'Unique allocation alloc_5512',
        toSequence: 32,
      },
      {
        sequence: 34,
        typeLabel: 'RECEIVABLE_CLOSURE',
        text: 'ERP closure observed · ev_e901…33',
        toSequence: 34,
      },
      { sequence: null, typeLabel: 'CASE', text: `${CASE_ID} · Seller transfer not observed` },
    ],
    metadata: {
      identityActor: 'MoneyTrace verification worker',
      identitySub: 'svc_verification',
      actorRole: 'system · verification contract executor',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: 'VC-TRANSFER-RESTORE v1.4.0',
      resourceVersion: 'case v7 · run v5',
      policyVersion: 'policy-bundle v12',
      promptModelVersion: null,
      artifactHash: { short: '3f9a…ab30', full: '3f9a72c1084bd5e6207714cc8891ab30' },
      evidenceSetHash: EVIDENCE_HASH,
      requestId: 'req_9f4b21c7',
      correlationId: 'corr_2077_v4_01',
    },
  },
  {
    sequence: 32,
    artifactId: auditId(32),
    artifactType: 'RECONCILIATION',
    kindLabel: 'RECONCILIATION EVIDENCE',
    title: 'Unique allocation recorded',
    rowSummary: 'Unique allocation recorded',
    actor: 'MoneyTrace',
    createdLocalShort: '25 Aug 11:20 IST',
    createdLocalFull: '25 Aug 2026, 11:20:00 IST',
    createdUtc: '2026-08-25T05:50:00Z',
    outcome: { label: 'Unique — no double counting', tone: 'success' },
    explanation:
      'The bank credit observed at #30 was allocated to this case’s expectation. The allocation is unique: no other case or expectation may claim the same bank line.',
    fields: [
      {
        kind: 'text',
        label: 'Allocation status',
        text: 'Unique — no double counting',
        tone: 'success',
      },
      { kind: 'text', label: 'Bank reference', text: 'ev_b74c…08', mono: true },
      { kind: 'money', label: 'Expectation', money: AMOUNT },
      { kind: 'money', label: 'Difference', money: { amount_minor: '0', currency: 'INR' } },
      { kind: 'text', label: 'Closure', text: 'Pending', mono: true },
      { kind: 'text', label: 'Reversal', text: 'None', mono: true },
    ],
    related: [
      {
        sequence: 30,
        typeLabel: 'EVIDENCE',
        text: 'Independent bank credit observed',
        toSequence: 30,
      },
      { sequence: null, typeLabel: 'CASE', text: `${CASE_ID} · Seller transfer not observed` },
    ],
    metadata: {
      identityActor: 'MoneyTrace reconciliation worker',
      identitySub: 'svc_reconciliation',
      actorRole: 'system · reconciliation engine',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: 'VC-TRANSFER-RESTORE v1.4.0',
      resourceVersion: 'case v7 · run v5',
      policyVersion: null,
      promptModelVersion: null,
      artifactHash: hashFor('e2af', '5c90'),
      evidenceSetHash: EVIDENCE_HASH,
      requestId: 'req_1d84fa22',
      correlationId: 'corr_2077_v4_01',
    },
  },
  {
    sequence: 34,
    artifactId: auditId(34),
    artifactType: 'RECEIVABLE_CLOSURE',
    kindLabel: 'RECONCILIATION EVIDENCE',
    title: 'ERP closure observed',
    rowSummary: 'ERP closure observed',
    actor: 'Synthetic ERP',
    createdLocalShort: '25 Aug 11:29 IST',
    createdLocalFull: '25 Aug 2026, 11:29:00 IST',
    createdUtc: '2026-08-25T05:59:00Z',
    outcome: { label: 'Closed — evidenced', tone: 'success' },
    explanation:
      'The synthetic ERP connector reported the matching receivable as closed, corroborating the bank credit and allocation already recorded.',
    fields: [
      { kind: 'text', label: 'Allocation status', text: 'Matched', tone: 'success' },
      { kind: 'text', label: 'Bank reference', text: 'ev_e901…33', mono: true },
      { kind: 'money', label: 'Expectation', money: AMOUNT },
      { kind: 'money', label: 'Difference', money: { amount_minor: '0', currency: 'INR' } },
      { kind: 'text', label: 'Closure', text: 'Closed — evidenced', tone: 'success', strong: true },
      { kind: 'text', label: 'Reversal', text: 'None', mono: true },
    ],
    related: [
      {
        sequence: 32,
        typeLabel: 'RECONCILIATION',
        text: 'Unique allocation recorded',
        toSequence: 32,
      },
      { sequence: null, typeLabel: 'CASE', text: `${CASE_ID} · Seller transfer not observed` },
    ],
    metadata: {
      identityActor: 'Synthetic ERP connector',
      identitySub: 'svc_erp_ingest',
      actorRole: 'system · source connector',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: 'VC-TRANSFER-RESTORE v1.4.0',
      resourceVersion: 'case v7 · run v5',
      policyVersion: null,
      promptModelVersion: null,
      artifactHash: hashFor('e901', '3391'),
      evidenceSetHash: EVIDENCE_HASH,
      requestId: 'req_ff203b6c',
      correlationId: 'corr_2077_v4_01',
    },
  },
  {
    sequence: 36,
    artifactId: auditId(36),
    artifactType: 'MANUAL_LINK',
    kindLabel: 'CASE CONTROL',
    title: 'Candidate relationship confirmed',
    rowSummary: 'Candidate relationship confirmed',
    actor: 'user_investigator',
    createdLocalShort: '25 Aug 11:33 IST',
    createdLocalFull: '25 Aug 2026, 11:33:00 IST',
    createdUtc: '2026-08-25T06:03:00Z',
    outcome: { label: 'Candidate → confirmed', tone: 'success' },
    explanation:
      'A human investigator manually confirmed a matcher-suggested relationship between this case and its verification evidence, above the automatic-match confidence threshold.',
    fields: [
      { kind: 'text', label: 'From', text: 'candidate', mono: true },
      { kind: 'text', label: 'To', text: 'confirmed', mono: true, strong: true },
      { kind: 'text', label: 'Control', text: 'CTL-04', mono: true },
      { kind: 'text', label: 'Triggered by', text: 'A. Rao · user_investigator' },
    ],
    related: [
      {
        sequence: 31,
        typeLabel: 'VERIFICATION',
        text: 'Verification contract run — passed',
        toSequence: 31,
      },
      { sequence: null, typeLabel: 'CASE', text: `${CASE_ID} · Seller transfer not observed` },
    ],
    metadata: {
      identityActor: 'A. Rao',
      identitySub: 'user_investigator',
      actorRole: 'human · investigator',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: null,
      resourceVersion: 'case v7',
      policyVersion: null,
      promptModelVersion: null,
      artifactHash: hashFor('1450', 'b4c9'),
      evidenceSetHash: EVIDENCE_HASH,
      requestId: 'req_82a1f60e',
      correlationId: 'corr_2077_v4_01',
    },
  },
  {
    sequence: 39,
    artifactId: auditId(39),
    artifactType: 'RECONCILIATION_REVERSAL',
    kindLabel: 'ADMINISTRATIVE RECORD',
    title: 'Allocation reversed after refund',
    rowSummary: 'Allocation reversed after refund',
    actor: 'MoneyTrace · system',
    createdLocalShort: '25 Aug 09:47 IST',
    createdLocalFull: '25 Aug 2026, 09:47:00 IST',
    createdUtc: '2026-08-25T04:17:00Z',
    outcome: { label: 'Reversed', tone: 'danger' },
    explanation:
      'A different case’s allocation was reversed after an authoritative refund was observed. This entry is not for CASE-2077 but is retained in the same audit_sequence, since sequence order is server-owned and never re-derived from timestamps.',
    fields: [
      { kind: 'text', label: 'Command', text: 'reconciliation.reverse', mono: true, strong: true },
      { kind: 'text', label: 'Operator', text: 'MoneyTrace · system', mono: true },
      { kind: 'text', label: 'Dataset version', text: 'synthetic-2026-08', mono: true },
    ],
    related: [{ sequence: null, typeLabel: 'CASE', text: 'CASE-2041 · Claim reversal scenario' }],
    metadata: {
      identityActor: 'MoneyTrace reconciliation worker',
      identitySub: 'svc_reconciliation',
      actorRole: 'system · reconciliation engine',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: null,
      resourceVersion: 'case v3',
      policyVersion: null,
      promptModelVersion: null,
      artifactHash: hashFor('7c14', '2af0'),
      evidenceSetHash: null,
      requestId: 'req_ec019a3d',
      correlationId: 'corr_2041_v3_01',
    },
  },
  {
    sequence: 41,
    artifactId: auditId(41),
    artifactType: 'DATASET_IMPORT',
    kindLabel: 'ADMINISTRATIVE RECORD',
    title: 'Synthetic dataset imported',
    rowSummary: 'Synthetic dataset imported',
    actor: 'user_operator',
    createdLocalShort: '25 Aug 08:02 IST',
    createdLocalFull: '25 Aug 2026, 08:02:00 IST',
    createdUtc: '2026-08-25T02:32:00Z',
    explanation:
      'A Demo Operator imported the registered synthetic dataset, establishing the fixed baseline every scenario in this demo replays from.',
    fields: [
      { kind: 'text', label: 'Command', text: 'dataset.import', mono: true, strong: true },
      { kind: 'text', label: 'Operator', text: 'user_operator', mono: true },
      { kind: 'text', label: 'Dataset version', text: 'synthetic-2026-08', mono: true },
    ],
    related: [],
    metadata: {
      identityActor: 'Demo Operator',
      identitySub: 'user_operator',
      actorRole: 'human · demo operator',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: null,
      resourceVersion: null,
      policyVersion: null,
      promptModelVersion: null,
      artifactHash: hashFor('0d5e', '9a71'),
      evidenceSetHash: null,
      requestId: 'req_006d0c02',
      correlationId: null,
    },
  },
  {
    sequence: 42,
    artifactId: auditId(42),
    artifactType: 'DEMO_COMMAND',
    kindLabel: 'ADMINISTRATIVE RECORD',
    title: 'Scenario advanced to step 4 of 4',
    rowSummary: 'Scenario advanced to step 4 of 4',
    actor: 'user_operator',
    createdLocalShort: '25 Aug 11:32 IST',
    createdLocalFull: '25 Aug 2026, 11:32:00 IST',
    createdUtc: '2026-08-25T06:02:00Z',
    explanation:
      'A Demo Operator advanced the missing-transfer-remediation scenario controller to its final step, completing the deterministic sequence this case replays.',
    fields: [
      { kind: 'text', label: 'Command', text: 'scenario.advance', mono: true, strong: true },
      { kind: 'text', label: 'Operator', text: 'user_operator', mono: true },
      { kind: 'text', label: 'Dataset version', text: 'synthetic-2026-08', mono: true },
    ],
    related: [
      { sequence: null, typeLabel: 'CASE', text: `${CASE_ID} · Seller transfer not observed` },
    ],
    metadata: {
      identityActor: 'Demo Operator',
      identitySub: 'user_operator',
      actorRole: 'human · demo operator',
      schemaVersion: 'audit.v1.4.0',
      contractVersion: null,
      resourceVersion: null,
      policyVersion: null,
      promptModelVersion: null,
      artifactHash: hashFor('9f61', '3ac4'),
      evidenceSetHash: null,
      requestId: 'req_74e0b915',
      correlationId: null,
    },
  },
];

/** Case-total category counts, as returned by the server alongside this page. */
export const CATEGORY_TOTALS: Readonly<Record<AuditCategoryKey, number>> = {
  'source-facts': 14,
  'derived-controls': 6,
  investigation: 4,
  policy: 3,
  'human-approval': 2,
  'simulated-action': 5,
  verification: 6,
  'reversal-admin-demo': 3,
};

export const CASE_TOTAL_ENTRIES = 42;
export const CASE_LATEST_SEQUENCE = 42;
export const CASE_REDACTION_PROFILE = 'operator_full';
export const CASE_DEMO_ROLE = 'Demo Operator / Auditor';

export const AUDIT_EXPORT = {
  generatedAtLocal: '25 Aug 2026, 11:41:02 IST',
  generatedAtUtc: '06:11:02 UTC',
  entryCount: CASE_TOTAL_ENTRIES,
  redactionProfile: CASE_REDACTION_PROFILE,
  contentSha256: {
    short: '8f2c41d9…c8e05b44',
    full: '8f2c41d9a0b77e3c5518ab6402ff91de73c4a2801bb5e6094f3d7a12c8e05b44',
  } satisfies HashPair,
};

/* -------------------------------------------------------------------------- */
/*  Per-case audit bundle — a case-scoped view of everything the Audit Replay  */
/*  page consumes, so every queue case has its own replayable trail, not only  */
/*  the hand-authored flagship.                                                */
/* -------------------------------------------------------------------------- */

export interface AuditBundle {
  readonly rows: readonly AuditRowVM[];
  readonly totalEntries: number;
  readonly latestSequence: number;
  readonly redactionProfile: string;
  readonly demoRole: string;
  readonly categoryTotals: Readonly<Record<AuditCategoryKey, number>>;
  readonly export: {
    readonly generatedAtLocal: string;
    readonly generatedAtUtc: string;
    readonly entryCount: number;
    readonly redactionProfile: string;
    readonly contentSha256: HashPair;
  };
}

/** The hand-authored flagship trail, packaged as a bundle. */
export const CASE_2077_BUNDLE: AuditBundle = {
  rows: CASE_2077_AUDIT,
  totalEntries: CASE_TOTAL_ENTRIES,
  latestSequence: CASE_LATEST_SEQUENCE,
  redactionProfile: CASE_REDACTION_PROFILE,
  demoRole: CASE_DEMO_ROLE,
  categoryTotals: CATEGORY_TOTALS,
  export: AUDIT_EXPORT,
};

function auditSeed(caseId: string): number {
  let hash = 0;
  for (let index = 0; index < caseId.length; index += 1) {
    hash = (hash * 31 + caseId.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function genHash(seed: number, salt: number): HashPair {
  const prefix = (((seed ^ (salt * 40503)) >>> 0) % 0xffff).toString(16).padStart(4, '0');
  const suffix = (((seed ^ (salt * 2654435761)) >>> 0) % 0xffff).toString(16).padStart(4, '0');
  return hashFor(prefix, suffix);
}

function istShort(iso: string, addMinutes: number): string {
  const date = new Date(new Date(iso).getTime() + addMinutes * 60_000);
  return `${new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  })
    .format(date)
    .replace(',', '')} IST`;
}

function istFull(iso: string, addMinutes: number): string {
  const date = new Date(new Date(iso).getTime() + addMinutes * 60_000);
  return `${new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  })
    .format(date)
    .replace(',', ',')} IST`;
}

function utcStamp(iso: string, addMinutes: number): string {
  return new Date(new Date(iso).getTime() + addMinutes * 60_000).toISOString().replace('.000', '');
}

/**
 * Build a complete, deterministic audit bundle for any queue case from its
 * summary. The trail spans the same category set as the flagship (source facts →
 * control → investigation → policy → approval → action → verification →
 * reconciliation → demo command), sized to the case's own state.
 */
export function buildGeneratedAudit(summary: CaseSummary, display: CaseDisplayMeta): AuditBundle {
  const seed = auditSeed(summary.case_id);
  const amount = summary.exposure;
  const opened = summary.opened_at;
  const actorRole = 'human · investigator';
  const evidenceSetHash = genHash(seed, 9);
  const resolved = summary.outcome_status === 'VERIFIED' || summary.outcome_status === 'REVERSED';
  const reversed = summary.outcome_status === 'REVERSED';

  const baseMeta = (salt: number): AuditRowVM['metadata'] => ({
    identityActor: 'Synthetic pipeline',
    identitySub: summary.control_id,
    actorRole,
    schemaVersion: 'audit.v1.4.0',
    contractVersion: null,
    resourceVersion: String(summary.resource_version),
    policyVersion: 'policy-bundle.v12',
    promptModelVersion: null,
    artifactHash: genHash(seed, salt),
    evidenceSetHash,
    requestId: `req_${genHash(seed, salt + 1).full.slice(0, 8)}`,
    correlationId: null,
  });

  const id = (sequence: number): string =>
    `aud_${summary.case_id.replace(/[^0-9]/g, '') || '0000'}_${sequence
      .toString()
      .padStart(4, '0')}`;

  const rows: AuditRowVM[] = [
    {
      sequence: 12,
      artifactId: id(12),
      artifactType: 'EVIDENCE',
      kindLabel: 'SOURCE EVIDENCE',
      title: 'Payment captured',
      rowSummary: 'Payment captured',
      actor: 'Synthetic Payments',
      createdLocalShort: istShort(opened, 12),
      createdLocalFull: istFull(opened, 12),
      createdUtc: utcStamp(opened, 12),
      outcome: { label: 'Accepted', tone: 'success' },
      explanation:
        'A captured payment is a source fact ingested from the payments API with a verified signature. It is an input, not a conclusion.',
      fields: [
        { kind: 'text', label: 'Event type', text: 'payment.captured', mono: true, strong: true },
        { kind: 'money', label: 'Amount', money: amount },
        { kind: 'text', label: 'Signature', text: 'verified', tone: 'success' },
      ],
      related: [
        { sequence: null, typeLabel: 'CASE', text: `${summary.case_id} · ${display.divergence}` },
      ],
      metadata: baseMeta(1),
    },
    {
      sequence: 14,
      artifactId: id(14),
      artifactType: 'CASE_TRANSITION',
      kindLabel: 'CASE CONTROL',
      title: `Case opened under ${summary.control_id}`,
      rowSummary: `Case opened · ${summary.control_id}`,
      actor: `Control ${summary.control_id}`,
      createdLocalShort: istShort(opened, 14),
      createdLocalFull: istFull(opened, 14),
      createdUtc: utcStamp(opened, 14),
      explanation: `${summary.control_id} derived an obligation from the captured payment and opened this case at exposure ${formatBundleMoney(amount)}.`,
      fields: [
        { kind: 'text', label: 'From state', text: 'candidate', mono: true },
        {
          kind: 'text',
          label: 'To state',
          text: summary.lifecycle_state,
          mono: true,
          strong: true,
        },
        { kind: 'money', label: 'Exposure', money: amount },
      ],
      related: [{ sequence: 12, typeLabel: 'EVIDENCE', text: 'Payment captured' }],
      metadata: baseMeta(2),
    },
    {
      sequence: 19,
      artifactId: id(19),
      artifactType: 'INVESTIGATION',
      kindLabel: 'INVESTIGATION',
      title: 'Deterministic investigation run',
      rowSummary: 'Investigation · deterministic-offline',
      actor: summary.owner_id ?? 'Unassigned',
      createdLocalShort: istShort(opened, 1200),
      createdLocalFull: istFull(opened, 1200),
      createdUtc: utcStamp(opened, 1200),
      outcome: { label: 'Safe to act: no', tone: 'warning' },
      explanation:
        'A deterministic, offline investigation summarised the evidence set. Its verdict is advisory; it is never authority to move money.',
      fields: [
        { kind: 'text', label: 'Mode', text: 'deterministic-offline', mono: true },
        {
          kind: 'coverage',
          label: 'Coverage',
          coverage: {
            label:
              summary.evidence_coverage === 'complete'
                ? 'Complete'
                : summary.evidence_coverage === 'partial'
                  ? 'Partial'
                  : 'None',
            done:
              summary.evidence_coverage === 'complete'
                ? 3
                : summary.evidence_coverage === 'partial'
                  ? 2
                  : 1,
            total: 3,
          },
        },
      ],
      related: [{ sequence: 14, typeLabel: 'CASE_TRANSITION', text: 'Case opened' }],
      metadata: { ...baseMeta(3), promptModelVersion: 'prompt.v3.2.0 / model synthetic' },
    },
    {
      sequence: 24,
      artifactId: id(24),
      artifactType: 'POLICY_DECISION',
      kindLabel: 'POLICY DECISION',
      title: 'Policy evaluated',
      rowSummary: `Policy · ${display.policyStatus}`,
      actor: 'Policy engine',
      createdLocalShort: istShort(opened, 1260),
      createdLocalFull: istFull(opened, 1260),
      createdUtc: utcStamp(opened, 1260),
      outcome: {
        label: display.policyStatus.replaceAll('_', ' '),
        tone:
          display.policyTone === 'success'
            ? 'success'
            : display.policyTone === 'danger'
              ? 'danger'
              : 'warning',
      },
      explanation: `The registered policy bundle evaluated the case and returned ${display.policy}.`,
      fields: [
        { kind: 'text', label: 'Bundle', text: 'policy-bundle v12', mono: true },
        { kind: 'text', label: 'Decision', text: display.policyStatus, mono: true, strong: true },
        { kind: 'text', label: 'Matched rule', text: `RULE-${summary.control_id}-02`, mono: true },
      ],
      related: [{ sequence: 19, typeLabel: 'INVESTIGATION', text: 'Investigation run' }],
      metadata: baseMeta(4),
    },
    ...(summary.lifecycle_state === 'approval_required'
      ? [
          {
            sequence: 28,
            artifactId: id(28),
            artifactType: 'APPROVAL' as ArtifactType,
            kindLabel: 'HUMAN APPROVAL',
            title: 'Approval requested',
            rowSummary: 'Approval · awaiting decision',
            actor: summary.owner_id ?? 'user_investigator',
            createdLocalShort: istShort(opened, 1320),
            createdLocalFull: istFull(opened, 1320),
            createdUtc: utcStamp(opened, 1320),
            outcome: { label: 'Awaiting decision', tone: 'warning' as const },
            explanation:
              'A human approval was requested. It is bound to the evidence-set basis hash; new evidence invalidates it.',
            fields: [
              { kind: 'text' as const, label: 'Required role', text: 'Finance Approver' },
              {
                kind: 'text' as const,
                label: 'Basis hash',
                text: evidenceSetHash.short,
                mono: true,
              },
            ],
            related: [{ sequence: 24, typeLabel: 'POLICY_DECISION', text: 'Policy evaluated' }],
            metadata: baseMeta(5),
          },
        ]
      : []),
    {
      sequence: 31,
      artifactId: id(31),
      artifactType: 'VERIFICATION',
      kindLabel: 'VERIFICATION',
      title: resolved ? 'Verification contract satisfied' : 'Verification contract not yet run',
      rowSummary: resolved ? 'Verification · satisfied' : 'Verification · pending',
      actor: 'Verification engine',
      createdLocalShort: istShort(opened, 1500),
      createdLocalFull: istFull(opened, 1500),
      createdUtc: utcStamp(opened, 1500),
      outcome: resolved
        ? { label: 'Satisfied', tone: 'success' }
        : { label: 'Pending', tone: 'warning' },
      explanation: resolved
        ? 'Independent bank evidence, unique allocation and ERP closure were all recorded. An acknowledgement alone is never sufficient.'
        : 'The verification contract has not been satisfied: independent bank evidence is still required. An acknowledgement is not verification.',
      fields: [
        {
          kind: 'coverage',
          label: 'Coverage',
          coverage: resolved
            ? { label: 'Complete', done: 3, total: 3 }
            : { label: 'Partial', done: 1, total: 3 },
        },
        {
          kind: resolved ? 'money' : 'notRecorded',
          label: 'Verified amount',
          ...(resolved ? { money: amount } : {}),
        } as DetailField,
      ],
      related: [{ sequence: 12, typeLabel: 'EVIDENCE', text: 'Payment captured' }],
      metadata: baseMeta(6),
    },
    {
      sequence: reversed ? 40 : 34,
      artifactId: id(reversed ? 40 : 34),
      artifactType: reversed ? 'RECONCILIATION_REVERSAL' : 'RECONCILIATION',
      kindLabel: reversed ? 'RECONCILIATION REVERSAL' : 'RECONCILIATION',
      title: reversed ? 'Recovery reversed after refund' : 'Reconciliation state',
      rowSummary: reversed ? 'Reversal · retained value → 0' : 'Reconciliation',
      actor: 'Reconciliation engine',
      createdLocalShort: istShort(opened, 1600),
      createdLocalFull: istFull(opened, 1600),
      createdUtc: utcStamp(opened, 1600),
      outcome: reversed
        ? { label: 'Reversed', tone: 'danger' }
        : resolved
          ? { label: 'Allocated', tone: 'success' }
          : { label: 'Not allocated', tone: 'warning' },
      explanation: reversed
        ? 'A refund correlated to the recovery payment was observed after the claim, so retained value returned to zero.'
        : resolved
          ? 'A unique bank-line allocation closed the receivable with no double counting.'
          : 'No allocation has been made yet; the difference remains at full exposure.',
      fields: [
        {
          kind: 'money',
          label: 'Difference',
          money: resolved ? { amount_minor: '0', currency: 'INR' } : amount,
        },
      ],
      related: [{ sequence: 31, typeLabel: 'VERIFICATION', text: 'Verification contract' }],
      metadata: baseMeta(7),
    },
    {
      sequence: 42,
      artifactId: id(42),
      artifactType: 'DEMO_COMMAND',
      kindLabel: 'DEMO COMMAND',
      title: 'Scenario advanced',
      rowSummary: 'Demo command · scenario.advance',
      actor: 'Demo Operator',
      createdLocalShort: istShort(opened, 1720),
      createdLocalFull: istFull(opened, 1720),
      createdUtc: utcStamp(opened, 1720),
      explanation:
        'A Demo Operator advanced the scenario controller, completing the deterministic sequence this case replays.',
      fields: [
        { kind: 'text', label: 'Command', text: 'scenario.advance', mono: true, strong: true },
        { kind: 'text', label: 'Operator', text: 'user_operator', mono: true },
        { kind: 'text', label: 'Dataset version', text: 'synthetic-2026-08', mono: true },
      ],
      related: [
        { sequence: null, typeLabel: 'CASE', text: `${summary.case_id} · ${display.divergence}` },
      ],
      metadata: { ...baseMeta(8), identityActor: 'Demo Operator', identitySub: 'user_operator' },
    },
  ];

  const categoryTotals = AUDIT_CATEGORIES.reduce(
    (totals, category) => {
      totals[category.key] = rows.filter(
        (row) => categoryForType(row.artifactType).key === category.key,
      ).length;
      return totals;
    },
    {} as Record<AuditCategoryKey, number>,
  );

  const latestSequence = rows.reduce((max, row) => Math.max(max, row.sequence), 0);

  return {
    rows,
    totalEntries: rows.length,
    latestSequence,
    redactionProfile: 'operator_full',
    demoRole: 'Demo Operator / Auditor',
    categoryTotals,
    export: {
      generatedAtLocal: '25 Aug 2026, 11:41:02 IST',
      generatedAtUtc: '06:11:02 UTC',
      entryCount: rows.length,
      redactionProfile: 'operator_full',
      contentSha256: genHash(seed, 99),
    },
  };
}

function formatBundleMoney(money: Money): string {
  const minor = BigInt(money.amount_minor);
  const rupees = minor / 100n;
  const paise = (minor % 100n).toString().padStart(2, '0');
  return `₹${rupees.toString()}.${paise} INR`;
}
