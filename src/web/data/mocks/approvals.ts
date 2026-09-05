import type { Money } from '../../../contracts/index.js';
import { getApprovalOverrides, type ApprovalOverride } from './approval-state.js';

/**
 * Approval Review view model (MoneyTrace Approval Review.dc.html, frames 1a–1c).
 * A page-local shape rather than the raw `ApprovalRecord` discriminated
 * union: display fields like requester name, required role and the six
 * decision-basis groups come from joined case/plan/policy context a real
 * backend would resolve server-side, not from the approval record alone.
 */
export interface HashPair {
  /** Truncated form shown on screen, e.g. `9b7e…40aa`. */
  readonly short: string;
  /** Full value carried in the accessible name; never depends on hover. */
  readonly full: string;
}

export interface EvidenceCoverageVM {
  readonly label: 'Partial' | 'Complete' | 'None';
  readonly done: number;
  readonly total: number;
}

/**
 * The six immutable decision-basis groups plus the terminal-state extras,
 * exactly as the drawer restates them. Amount strings stay in minor units and
 * are only ever formatted with BigInt.
 */
export interface ApprovalDetail {
  readonly caseSubtitle: string;
  readonly boundCaseVersion: string;
  readonly controlDivergence: string;
  readonly planId: string;
  readonly planVersion: string;
  readonly templateAction: string;
  readonly planHash: HashPair;
  readonly parameters: string;
  readonly targetSynthetic: string;
  readonly evidenceHash: HashPair;
  readonly coverage: EvidenceCoverageVM;
  readonly contradictions: number;
  readonly blockers: string | null;
  /** Amber coverage banner at the top of the basis; null when coverage is complete. */
  readonly coverageWarning: string | null;
  readonly policyBundle: string;
  readonly policyDecisionId: string;
  readonly policyOutcome: string;
  readonly matchedRules: string;
  readonly verificationContract: string;
  readonly expiryUtcFull: string | null;
  readonly basisHash: HashPair;
  readonly idempotencyKey: string;
  readonly separationOfDuties: string;
  /** Terminal-state extras (EXPIRED / INVALIDATED / decided rows). */
  readonly terminationReason?: string;
  readonly historicalBasis?: string;
  readonly decisionText?: string;
  readonly approverName?: string;
  readonly approverId?: string;
  readonly decidedAtLocal?: string;
  readonly decidedAtUtc?: string;
}

export interface ApprovalRowVM {
  readonly approvalId: string;
  readonly caseId: string;
  readonly amountImpact: Money;
  readonly action: string;
  readonly target: string;
  readonly requesterName: string;
  readonly requesterId: string;
  readonly requiredRole: string;
  readonly requestedDateLocal: string;
  readonly requestedTimeLocal: string;
  readonly requestedUtcTitle: string;
  readonly expiresLocal: string | null;
  readonly expiresUtcTitle: string | null;
  readonly expiryNote: string;
  readonly expiryTone: 'warning' | 'danger' | 'neutral' | 'expired';
  readonly state: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'INVALIDATED';
  readonly decisionNote?: string;
  readonly detail: ApprovalDetail;
}

export const APPROVAL_TABS: readonly {
  readonly key: ApprovalRowVM['state'];
  readonly label: string;
  readonly count: number;
}[] = [
  { key: 'REQUESTED', label: 'Requested', count: 7 },
  { key: 'APPROVED', label: 'Approved', count: 11 },
  { key: 'REJECTED', label: 'Rejected', count: 3 },
  { key: 'EXPIRED', label: 'Expired', count: 2 },
  { key: 'INVALIDATED', label: 'Invalidated', count: 1 },
];

const BASE_DETAIL: ApprovalDetail = {
  caseSubtitle: 'Seller transfer not observed after captured payment',
  boundCaseVersion: '7',
  controlDivergence:
    'CTL-04 · transfer not observed at payout · first divergence at the Transfer node',
  planId: 'PLAN-TRANSFER-RETRY',
  planVersion: 'v4',
  templateAction: 'transfer.retry — retry a single unobserved seller transfer',
  planHash: { short: '9b7e…40aa', full: '9b7e40aa3c18f5d2e6b04417cc9182fa5d70e3b1' },
  parameters:
    'amount_minor "45500000" · currency "INR" · destination "seller_acct_7741" · window_hours 24 · max_attempts 1',
  targetSynthetic: 'seller_acct_7741',
  evidenceHash: { short: '5c1a…d38b', full: '5c1ad38b7742e0091fbc3a5d6e8471c2' },
  coverage: { label: 'Partial', done: 2, total: 3 },
  contradictions: 0,
  blockers: 'Independent bank credit evidence missing · ERP closure not requested',
  coverageWarning:
    'Evidence coverage is Partial (2 of 3). Bank credit evidence is missing. Approving authorises the simulated action; it does not verify recovery. Warnings cannot be dismissed to override policy.',
  policyBundle: 'v12 · c31f…7d20',
  policyDecisionId: 'POL-DEC-88214',
  policyOutcome: 'ALLOW WITH APPROVAL',
  matchedRules:
    'RULE-TRANSFER-REMEDIATION-02 — material exposure, single obligation, no contradiction',
  verificationContract: 'VC-TRANSFER-RESTORE · v1.4.0',
  expiryUtcFull: '2026-08-26 05:22:00 UTC',
  basisHash: { short: 'a17f…14c3', full: 'a17f92bc4408d31e77052fa6bb9e14c3' },
  idempotencyKey: 'idem_2077_v4_01',
  separationOfDuties: 'Satisfied — you are not the requester',
};

export const MOCK_APPROVALS: readonly ApprovalRowVM[] = [
  {
    approvalId: 'APR-4471',
    caseId: 'CASE-2077',
    amountImpact: { amount_minor: '45500000', currency: 'INR' },
    action: 'transfer.retry',
    target: '→ seller_acct_7741',
    requesterName: 'A. Rao',
    requesterId: 'user_investigator',
    requiredRole: 'Finance Approver',
    requestedDateLocal: '25 Aug',
    requestedTimeLocal: '10:52 IST',
    requestedUtcTitle: '25 August 2026, 05:22:00 UTC',
    expiresLocal: '26 Aug 10:52 IST',
    expiresUtcTitle: '26 August 2026, 05:22:00 UTC',
    expiryNote: 'Expires in 4h 12m',
    expiryTone: 'warning',
    state: 'REQUESTED',
    detail: { ...BASE_DETAIL },
  },
  {
    approvalId: 'APR-4468',
    caseId: 'CASE-2043',
    amountImpact: { amount_minor: '64000000', currency: 'INR' },
    action: 'reconciliation.hold',
    target: '→ obligation_2043',
    requesterName: 'K. Iyer',
    requesterId: 'user_investigator',
    requiredRole: 'Finance Approver',
    requestedDateLocal: '25 Aug',
    requestedTimeLocal: '08:34 IST',
    requestedUtcTitle: '25 August 2026, 03:04:00 UTC',
    expiresLocal: '25 Aug 18:04 IST',
    expiresUtcTitle: '25 August 2026, 12:34:00 UTC',
    expiryNote: 'Expires in 38m',
    expiryTone: 'danger',
    state: 'REQUESTED',
    detail: {
      ...BASE_DETAIL,
      caseSubtitle: 'Reconciliation hold requested on an open obligation',
      boundCaseVersion: '3',
      controlDivergence:
        'CTL-07 · settlement timeout · first divergence at the Reconciliation node',
      planId: 'PLAN-RECON-HOLD',
      templateAction: 'reconciliation.hold — hold an open obligation for manual reconciliation',
      planHash: { short: 'c204…6b19', full: 'c2046b1907e5a4413cf0d8825ba61e774209ac35' },
      parameters:
        'amount_minor "64000000" · currency "INR" · obligation "obligation_2043" · window_hours 24',
      targetSynthetic: 'obligation_2043',
      evidenceHash: { short: 'ba71…09c4', full: 'ba7109c4d5e21f8830ab46c7159e0d22' },
      coverage: { label: 'Complete', done: 3, total: 3 },
      contradictions: 0,
      blockers: null,
      coverageWarning: null,
      policyDecisionId: 'POL-DEC-88190',
      matchedRules: 'RULE-RECON-HOLD-01 — open obligation, single hold, no contradiction',
      verificationContract: 'VC-RECON-HOLD · v1.1.0',
      expiryUtcFull: '2026-08-25 12:34:00 UTC',
      basisHash: { short: 'd8c2…41af', full: 'd8c241af6620b7e3159084cc7fe2b013' },
      idempotencyKey: 'idem_2043_v3_01',
    },
  },
  {
    approvalId: 'APR-4460',
    caseId: 'CASE-2031',
    amountImpact: { amount_minor: '32000000', currency: 'INR' },
    action: 'duplicate.release',
    target: '→ collection_5512',
    requesterName: 'S. Menon',
    requesterId: 'user_investigator',
    requiredRole: 'Finance Approver',
    requestedDateLocal: '24 Aug',
    requestedTimeLocal: '16:40 IST',
    requestedUtcTitle: '24 August 2026, 11:10:00 UTC',
    expiresLocal: '26 Aug 16:40 IST',
    expiresUtcTitle: '26 August 2026, 11:10:00 UTC',
    expiryNote: 'Expires in 1d 10h',
    expiryTone: 'neutral',
    state: 'REQUESTED',
    detail: {
      ...BASE_DETAIL,
      caseSubtitle: 'Duplicate collection held for release review',
      boundCaseVersion: '5',
      controlDivergence:
        'CTL-04 · duplicate recovery risk · first divergence at the Collection node',
      planId: 'PLAN-DUPLICATE-RELEASE',
      templateAction: 'duplicate.release — release a held duplicate collection',
      planHash: { short: '4c70…88de', full: '4c7088de1a5b90336fe2c04d81be99a7' },
      parameters:
        'amount_minor "32000000" · currency "INR" · collection "collection_5512" · window_hours 48',
      targetSynthetic: 'collection_5512',
      evidenceHash: { short: 'b301…7a12', full: 'b3017a1240e6cd8859ff21b3a70c9e51' },
      coverage: { label: 'Complete', done: 3, total: 3 },
      contradictions: 0,
      blockers: null,
      coverageWarning: null,
      policyDecisionId: 'POL-DEC-88121',
      matchedRules: 'RULE-DUPLICATE-RELEASE-02 — single collection, verified duplicate',
      verificationContract: 'VC-DUPLICATE-RELEASE · v1.2.0',
      expiryUtcFull: '2026-08-26 11:10:00 UTC',
      basisHash: { short: 'e550…9f4c', full: 'e5509f4c2210ab7738c0d16e4a9b0f83' },
      idempotencyKey: 'idem_2031_v5_01',
    },
  },
  {
    approvalId: 'APR-4402',
    caseId: 'CASE-2011',
    amountImpact: { amount_minor: '8000000', currency: 'INR' },
    action: 'transfer.retry',
    target: '→ seller_acct_2210',
    requesterName: 'A. Rao',
    requesterId: 'user_investigator',
    requiredRole: 'Finance Approver',
    requestedDateLocal: '23 Aug',
    requestedTimeLocal: '12:15 IST',
    requestedUtcTitle: '23 August 2026, 06:45:00 UTC',
    expiresLocal: '24 Aug 12:15 IST',
    expiresUtcTitle: '24 August 2026, 06:45:00 UTC',
    expiryNote: 'Expired 1d 22h ago',
    expiryTone: 'expired',
    state: 'EXPIRED',
    decisionNote: 'no decision recorded',
    detail: {
      ...BASE_DETAIL,
      caseSubtitle: 'Seller transfer not observed after captured payment',
      boundCaseVersion: '3',
      controlDivergence:
        'CTL-04 · transfer not observed at payout · first divergence at the Transfer node',
      parameters:
        'amount_minor "8000000" · currency "INR" · destination "seller_acct_2210" · window_hours 24 · max_attempts 1',
      targetSynthetic: 'seller_acct_2210',
      coverage: { label: 'Partial', done: 2, total: 3 },
      coverageWarning: null,
      expiryUtcFull: '2026-08-24 06:45:00 UTC',
      basisHash: { short: '61aa…c008', full: '61aac00822f4e9b1370dd5a6cc41e8b9' },
      idempotencyKey: 'idem_2011_v3_01',
      terminationReason:
        'The approval window closed at 24 Aug 2026, 12:15 IST (06:45:00 UTC) with no decision recorded. Expiry is a termination, not a rejection — the basis is preserved for audit and a new request must be raised against the current case version.',
      historicalBasis: 'CASE-2011 v3 · plan v1 · basis 61aa…c008',
      decisionText: 'None recorded',
    },
  },
  {
    approvalId: 'APR-4390',
    caseId: 'CASE-2054',
    amountImpact: { amount_minor: '50000000', currency: 'INR' },
    action: 'duplicate.block',
    target: '→ collection_4471',
    requesterName: 'P. Shah',
    requesterId: 'user_investigator',
    requiredRole: 'Finance Approver',
    requestedDateLocal: '20 Aug',
    requestedTimeLocal: '14:32 IST',
    requestedUtcTitle: '20 August 2026, 09:02:00 UTC',
    expiresLocal: null,
    expiresUtcTitle: null,
    expiryNote: 'n/a — decided before expiry',
    expiryTone: 'neutral',
    state: 'APPROVED',
    decisionNote: 'S. Menon · 20 Aug 15:04 IST',
    detail: {
      ...BASE_DETAIL,
      caseSubtitle: 'Duplicate collection blocked before a second collection',
      boundCaseVersion: '4',
      controlDivergence:
        'CTL-04 · duplicate recovery risk · first divergence at the Collection node',
      planId: 'PLAN-DUPLICATE-BLOCK',
      templateAction: 'duplicate.block — block a second collection on a settled obligation',
      planHash: { short: '77af…21b0', full: '77af21b03cd9e8114520fa76bb0e9c33' },
      parameters:
        'amount_minor "50000000" · currency "INR" · collection "collection_4471" · window_hours 24',
      targetSynthetic: 'collection_4471',
      evidenceHash: { short: 'ad91…5e70', full: 'ad915e7042c0bb8319ff26a1c740d9e2' },
      coverage: { label: 'Complete', done: 3, total: 3 },
      contradictions: 0,
      blockers: null,
      coverageWarning: null,
      policyDecisionId: 'POL-DEC-87990',
      matchedRules: 'RULE-DUPLICATE-BLOCK-01 — confirmed duplicate, single obligation',
      verificationContract: 'VC-DUPLICATE-BLOCK · v1.0.0',
      expiryUtcFull: null,
      basisHash: { short: '9d20…7c41', full: '9d207c41aa6b31e8850fd42c7e0b9a15' },
      idempotencyKey: 'idem_2054_v4_01',
      separationOfDuties: 'Satisfied — decided by a different Finance Approver',
      decisionText: 'Approved — HUMAN APPROVAL recorded',
      approverName: 'S. Menon',
      approverId: 'user_approver',
      decidedAtLocal: '20 Aug 2026, 15:04:00 IST',
      decidedAtUtc: '09:34:00 UTC',
    },
  },
  {
    approvalId: 'APR-4415',
    caseId: 'CASE-2062',
    amountImpact: { amount_minor: '8000000', currency: 'INR' },
    action: 'transfer.retry',
    target: '→ seller_acct_9930',
    requesterName: 'K. Iyer',
    requesterId: 'user_investigator',
    requiredRole: 'Finance Approver',
    requestedDateLocal: '21 Aug',
    requestedTimeLocal: '09:10 IST',
    requestedUtcTitle: '21 August 2026, 03:40:00 UTC',
    expiresLocal: null,
    expiresUtcTitle: null,
    expiryNote: 'n/a — decided before expiry',
    expiryTone: 'neutral',
    state: 'REJECTED',
    decisionNote: 'S. Menon · 21 Aug 11:02 IST',
    detail: {
      ...BASE_DETAIL,
      caseSubtitle: 'Seller transfer with unresolved contradicting evidence',
      boundCaseVersion: '2',
      controlDivergence:
        'CTL-05 · conflicting bank evidence · first divergence at the Transfer node',
      parameters:
        'amount_minor "8000000" · currency "INR" · destination "seller_acct_9930" · window_hours 24 · max_attempts 1',
      targetSynthetic: 'seller_acct_9930',
      evidenceHash: { short: 'f0aa…3d18', full: 'f0aa3d1877c0be2244190af5c3e18b02' },
      coverage: { label: 'Partial', done: 2, total: 3 },
      contradictions: 1,
      blockers: 'Contradicting bank evidence unresolved',
      coverageWarning: null,
      policyDecisionId: 'POL-DEC-88044',
      matchedRules: 'RULE-TRANSFER-REMEDIATION-02 — material exposure, single obligation',
      expiryUtcFull: null,
      basisHash: { short: '3c8e…77a0', full: '3c8e77a0119b4ee2260dd8a5cc0f7431' },
      idempotencyKey: 'idem_2062_v2_01',
      separationOfDuties: 'Satisfied — decided by a different Finance Approver',
      decisionText: 'Rejected — reason: contradicting evidence unresolved',
      approverName: 'S. Menon',
      approverId: 'user_approver',
      decidedAtLocal: '21 Aug 2026, 11:02:00 IST',
      decidedAtUtc: '05:32:00 UTC',
    },
  },
  {
    approvalId: 'APR-4388',
    caseId: 'CASE-2031',
    amountImpact: { amount_minor: '32000000', currency: 'INR' },
    action: 'duplicate.release',
    target: '→ collection_5512',
    requesterName: 'S. Menon',
    requesterId: 'user_investigator',
    requiredRole: 'Finance Approver',
    requestedDateLocal: '24 Aug',
    requestedTimeLocal: '16:40 IST',
    requestedUtcTitle: '24 August 2026, 11:10:00 UTC',
    expiresLocal: null,
    expiresUtcTitle: null,
    expiryNote: 'invalidated — decision basis changed',
    expiryTone: 'neutral',
    state: 'INVALIDATED',
    decisionNote: 'New evidence changed the decision-basis hash; re-requested as APR-4460.',
    detail: {
      ...BASE_DETAIL,
      caseSubtitle: 'Duplicate collection held for release review',
      boundCaseVersion: '5',
      controlDivergence:
        'CTL-04 · duplicate recovery risk · first divergence at the Collection node',
      planId: 'PLAN-DUPLICATE-RELEASE',
      planVersion: 'v2',
      templateAction: 'duplicate.release — release a held duplicate collection',
      planHash: { short: '4c70…88de', full: '4c7088de1a5b90336fe2c04d81be99a7' },
      parameters:
        'amount_minor "32000000" · currency "INR" · collection "collection_5512" · window_hours 48',
      targetSynthetic: 'collection_5512',
      evidenceHash: { short: 'b301…7a12', full: 'b3017a1240e6cd8859ff21b3a70c9e51' },
      coverage: { label: 'Partial', done: 2, total: 3 },
      contradictions: 1,
      blockers: 'Contradicting evidence changed the sealed evidence set',
      coverageWarning: null,
      policyDecisionId: 'POL-DEC-88121',
      matchedRules: 'RULE-DUPLICATE-RELEASE-02 — single collection, verified duplicate',
      verificationContract: 'VC-DUPLICATE-RELEASE · v1.2.0',
      expiryUtcFull: null,
      basisHash: { short: 'e550…9f4c', full: 'e5509f4c2210ab7738c0d16e4a9b0f83' },
      idempotencyKey: 'idem_2031_v5_00',
      terminationReason:
        'New contradicting evidence changed the sealed evidence set at 24 Aug 19:08 IST, so the decision basis no longer describes the case. A fresh request against the current basis is required; this record is retained unchanged.',
      historicalBasis: 'CASE-2031 v5 · plan v2 4c70…88de · evidence b301…7a12 · basis e550…9f4c',
      decisionText: 'None recorded — invalidated before a decision',
    },
  },
];

/** Apply a client-recorded decision to a fixture row (approve/reject move the
 * row to a terminal state; request-more-evidence keeps it REQUESTED with a note). */
function applyOverride(row: ApprovalRowVM, override: ApprovalOverride): ApprovalRowVM {
  const stamp = `${override.decidedByName} · ${override.decidedAtLocal}`;
  if (override.decision === 'approve') {
    return {
      ...row,
      state: 'APPROVED',
      expiryNote: 'n/a — decided before expiry',
      decisionNote: stamp,
      detail: {
        ...row.detail,
        decisionText: 'Approved — HUMAN APPROVAL recorded',
        approverName: override.decidedByName,
        approverId: override.decidedById,
        decidedAtLocal: override.decidedAtLocal,
      },
    };
  }
  if (override.decision === 'reject') {
    return {
      ...row,
      state: 'REJECTED',
      expiryNote: 'n/a — decided before expiry',
      decisionNote: stamp,
      detail: {
        ...row.detail,
        decisionText: `Rejected — reason: ${override.reason ?? 'not provided'}`,
        approverName: override.decidedByName,
        approverId: override.decidedById,
        decidedAtLocal: override.decidedAtLocal,
      },
    };
  }
  // request-more-evidence — remains REQUESTED, annotated.
  return {
    ...row,
    decisionNote: `More evidence requested · ${stamp}`,
  };
}

/** All fixture rows with any client-recorded decisions merged in. */
export function mergedApprovals(): readonly ApprovalRowVM[] {
  const overrides = getApprovalOverrides();
  return MOCK_APPROVALS.map((row) => {
    const override = overrides[row.approvalId];
    return override ? applyOverride(row, override) : row;
  });
}

export function approvalsByState(state: ApprovalRowVM['state']): readonly ApprovalRowVM[] {
  return mergedApprovals().filter((row) => row.state === state);
}

/** Live per-state counts for the tab badges (merged with client decisions). */
export function approvalTabCounts(): Record<ApprovalRowVM['state'], number> {
  const counts: Record<ApprovalRowVM['state'], number> = {
    REQUESTED: 0,
    APPROVED: 0,
    REJECTED: 0,
    EXPIRED: 0,
    INVALIDATED: 0,
  };
  for (const row of mergedApprovals()) counts[row.state] += 1;
  return counts;
}
