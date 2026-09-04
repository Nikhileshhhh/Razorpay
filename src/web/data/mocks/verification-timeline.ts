import type { CaseSummary } from '../../../contracts/index.js';
import { formatMoney } from '../../formatting/money.js';
import { MOCK_CASES } from './cases.js';

/**
 * Verification Timeline mock for CASE-2077 (MoneyTrace Verification
 * Timeline.dc.html, frame 1a — "downstream acknowledged, not verified").
 * Eleven fixed stages; a real backend would derive this from the action,
 * verification and reconciliation rows already modelled in
 * `case-workspace.ts`'s control-loop rail for the same case.
 */
export interface TimelineStageVM {
  readonly index: string;
  readonly title: string;
  readonly status: 'complete' | 'acknowledged' | 'waiting';
  readonly statusLabel: string;
  readonly time?: string;
  readonly source?: string;
  readonly reference?: string;
  readonly detail: string;
  readonly requiredForVerified?: boolean;
}

export const CASE_2077_TIMELINE: readonly TimelineStageVM[] = [
  {
    index: '01',
    title: 'Plan authorized',
    status: 'complete',
    statusLabel: 'COMPLETE',
    time: '25 Aug 11:02 IST',
    source: 'MoneyTrace · policy+approval',
    reference: 'ev_ap71…4b',
    detail: 'Human approval recorded against decision-basis hash a17f…14c3.',
  },
  {
    index: '02',
    title: 'Action reserved',
    status: 'complete',
    statusLabel: 'COMPLETE',
    time: '25 Aug 11:03 IST',
    source: 'MoneyTrace · idempotency',
    detail: 'Key idem_2077_v4_01 reserved; a replay cannot create a second attempt.',
  },
  {
    index: '03',
    title: 'Action submitted',
    status: 'complete',
    statusLabel: 'COMPLETE',
    time: '25 Aug 11:03 IST',
    source: 'Synthetic Route · submit',
    reference: 'ev_sb12…9d',
    detail:
      'transfer.retry submitted for ₹4,55,000.00 INR to seller_acct_7741. Synthetic action — no real money movement.',
  },
  {
    index: '04',
    title: 'Downstream acknowledged / outcome unknown',
    status: 'acknowledged',
    statusLabel: 'ACKNOWLEDGED — NOT VERIFICATION',
    time: '25 Aug 11:04 IST',
    source: 'Synthetic Route · acknowledgement',
    reference: 'ev_c210…7f',
    detail:
      'Route returned synthetic reference sim_tr_88a1. Authority class ACKNOWLEDGEMENT — it contributes nothing to the verification contract.',
  },
  {
    index: '05',
    title: 'Transfer observed',
    status: 'waiting',
    statusLabel: 'WAITING',
    source: 'Synthetic Route · transfer read · no timestamp yet',
    detail: 'No transfer record has been read for this obligation.',
  },
  {
    index: '06',
    title: 'Recipient settlement observed',
    status: 'waiting',
    statusLabel: 'WAITING',
    source: 'Synthetic Route · settlement read',
    detail: 'Settlement confirms recipient processing; it is not bank proof.',
  },
  {
    index: '07',
    title: 'Independent bank evidence matched',
    status: 'waiting',
    statusLabel: 'WAITING',
    source: 'Synthetic Bank · statement read',
    detail: 'No bank credit line has been matched to this obligation.',
    requiredForVerified: true,
  },
  {
    index: '08',
    title: 'Unique expectation allocation',
    status: 'waiting',
    statusLabel: 'WAITING',
    source: 'MoneyTrace · reconciliation',
    detail: 'Allocation cannot run until bank evidence exists.',
    requiredForVerified: true,
  },
  {
    index: '09',
    title: 'ERP closure requested',
    status: 'waiting',
    statusLabel: 'WAITING',
    source: 'Synthetic ERP · closure request',
    detail: 'Not requested. Requesting closure is not the same as observing it.',
  },
  {
    index: '10',
    title: 'ERP closure observed',
    status: 'waiting',
    statusLabel: 'WAITING',
    source: 'Synthetic ERP · closure read',
    detail: 'Closure has not been observed in the ERP read model.',
    requiredForVerified: true,
  },
  {
    index: '11',
    title: 'Financial outcome verified / unresolved / reversed',
    status: 'waiting',
    statusLabel: 'WAITING — NOT VERIFIED',
    detail:
      'Terminal outcome is withheld until stages 7, 8 and 10 are each complete. Exposure remains ₹4,55,000.00 INR.',
  },
];

export const CASE_2077_BLOCKERS: readonly { readonly title: string; readonly detail: string }[] = [
  {
    title: 'Missing bank credit',
    detail: 'Stage 7 cannot complete without an independent Synthetic Bank statement line.',
  },
  {
    title: 'Allocation not run',
    detail: 'Stage 8 waits on stage 7; no expectation has been allocated.',
  },
  {
    title: 'Closure not observed',
    detail: 'Stage 10 has no ERP closure record; stage 9 was never requested.',
  },
];

export const CASE_2077_SAFE_CONCLUSION =
  'The instruction was authorised, reserved once, submitted once, and accepted downstream. That chain is deterministic and auditable. It supports no claim about money having moved, and exposure stays at full value.';

export const CASE_2077_CONTEXTUAL_ACTION_NOTE =
  'POST /v1/actions/act_2077_01/verification-checks at run version 3. No Retry, Resubmit or Execute again exists in this state — the attempt is outstanding and its idempotency key is never regenerated.';

/* -------------------------------------------------------------------------- */
/*  Per-case verification bundle — every queue case gets its own stage-by-stage */
/*  timeline, outcome-aware, not only the hand-authored flagship.               */
/* -------------------------------------------------------------------------- */

export interface VerificationBundle {
  readonly bannerTone: 'warning' | 'success' | 'danger';
  readonly bannerTitle: string;
  readonly bannerBody: string;
  readonly stages: readonly TimelineStageVM[];
  readonly blockers: readonly { readonly title: string; readonly detail: string }[];
  readonly safeConclusion: string;
  readonly contextualActionNote: string;
}

const CASE_2077_BUNDLE: VerificationBundle = {
  bannerTone: 'warning',
  bannerTitle: 'Action acknowledged—not yet financially verified.',
  bannerBody:
    'Synthetic Route accepted the instruction at 25 Aug 11:04 IST. An acknowledgement records that a downstream system took the request — it is not evidence that money moved, and exposure is unchanged. Stages 5 to 11 are still waiting.',
  stages: CASE_2077_TIMELINE,
  blockers: CASE_2077_BLOCKERS,
  safeConclusion: CASE_2077_SAFE_CONCLUSION,
  contextualActionNote: CASE_2077_CONTEXTUAL_ACTION_NOTE,
};

function complete(index: string, title: string, detail: string, source: string): TimelineStageVM {
  return { index, title, status: 'complete', statusLabel: 'COMPLETE', source, detail };
}

function waiting(
  index: string,
  title: string,
  detail: string,
  source: string,
  requiredForVerified = false,
): TimelineStageVM {
  return {
    index,
    title,
    status: 'waiting',
    statusLabel: 'WAITING',
    source,
    detail,
    requiredForVerified,
  };
}

function generatedTimeline(summary: CaseSummary): VerificationBundle {
  const exposure = formatMoney(summary.exposure);
  const resolved = summary.outcome_status === 'VERIFIED';
  const reversed = summary.outcome_status === 'REVERSED';
  const partial = summary.evidence_coverage === 'partial';

  if (resolved || reversed) {
    const stages: TimelineStageVM[] = [
      complete(
        '01',
        'Plan authorized',
        'Human approval recorded against the decision-basis hash.',
        'MoneyTrace · policy+approval',
      ),
      complete(
        '02',
        'Action reserved',
        'Idempotency key reserved; a replay cannot create a second attempt.',
        'MoneyTrace · idempotency',
      ),
      complete(
        '03',
        'Action submitted',
        `Instruction submitted for ${exposure}. Synthetic action — no real money movement.`,
        'Synthetic Route · submit',
      ),
      complete(
        '04',
        'Downstream acknowledged',
        'Route returned a synthetic reference. Authority class ACKNOWLEDGEMENT — it never verifies money.',
        'Synthetic Route · acknowledgement',
      ),
      complete(
        '05',
        'Transfer observed',
        'A transfer record was read for this obligation.',
        'Synthetic Route · transfer read',
      ),
      complete(
        '06',
        'Recipient settlement observed',
        'Settlement confirmed recipient processing.',
        'Synthetic Route · settlement read',
      ),
      {
        ...complete(
          '07',
          'Independent bank evidence matched',
          'A bank credit line was matched to this obligation.',
          'Synthetic Bank · statement read',
        ),
        requiredForVerified: true,
      },
      {
        ...complete(
          '08',
          'Unique expectation allocation',
          'The obligation was allocated uniquely — no double counting.',
          'MoneyTrace · reconciliation',
        ),
        requiredForVerified: true,
      },
      complete(
        '09',
        'ERP closure requested',
        'Closure was requested from the ERP.',
        'Synthetic ERP · closure request',
      ),
      {
        ...complete(
          '10',
          'ERP closure observed',
          'Closure was observed in the ERP read model.',
          'Synthetic ERP · closure read',
        ),
        requiredForVerified: true,
      },
      reversed
        ? {
            index: '11',
            title: 'Financial outcome reversed',
            status: 'complete',
            statusLabel: 'REVERSED — NOT VERIFIED',
            detail: `A refund correlated to the recovery payment was observed after the claim, so retained value returned to ₹0.00. Exposure was ${exposure}.`,
          }
        : {
            index: '11',
            title: 'Financial outcome verified',
            status: 'complete',
            statusLabel: 'VERIFIED AFTER INDEPENDENT EVIDENCE',
            detail: `Stages 7, 8 and 10 are each complete, so the outcome is verified. Incremental recovery ${exposure}.`,
          },
    ];
    return {
      bannerTone: reversed ? 'danger' : 'success',
      bannerTitle: reversed
        ? 'Recovery reversed — never verified as retained money.'
        : 'Financial outcome verified after independent evidence.',
      bannerBody: reversed
        ? 'The action was acknowledged and later a correlated refund was observed, so retained value returned to zero. The acknowledgement was never verification.'
        : 'Independent bank evidence, unique allocation and ERP closure were all recorded. Verification requires all three; an acknowledgement alone is never sufficient.',
      stages,
      blockers: [],
      safeConclusion: reversed
        ? 'The instruction was authorised and acknowledged, but a correlated refund reversed it. No retained value is claimed; the trail is deterministic and auditable.'
        : 'The instruction was authorised, executed once, and confirmed by independent bank evidence, unique allocation and ERP closure. Retained value is supported end to end.',
      contextualActionNote: `GET /v1/cases/${summary.case_id}/verification at run version ${summary.resource_version}. The outcome is terminal; no further action is offered.`,
    };
  }

  // Pending / unresolved — mirror the flagship's "acknowledged, not verified" shape.
  const stages: TimelineStageVM[] = [
    complete(
      '01',
      'Plan authorized',
      'Human approval recorded against the decision-basis hash.',
      'MoneyTrace · policy+approval',
    ),
    complete(
      '02',
      'Action reserved',
      'Idempotency key reserved; a replay cannot create a second attempt.',
      'MoneyTrace · idempotency',
    ),
    complete(
      '03',
      'Action submitted',
      `Instruction submitted for ${exposure}. Synthetic action — no real money movement.`,
      'Synthetic Route · submit',
    ),
    {
      index: '04',
      title: 'Downstream acknowledged / outcome unknown',
      status: 'acknowledged',
      statusLabel: 'ACKNOWLEDGED — NOT VERIFICATION',
      source: 'Synthetic Route · acknowledgement',
      detail:
        'Route returned a synthetic reference. Authority class ACKNOWLEDGEMENT — it contributes nothing to the verification contract.',
    },
    waiting(
      '05',
      'Transfer observed',
      'No transfer record has been read for this obligation.',
      'Synthetic Route · transfer read',
    ),
    waiting(
      '06',
      'Recipient settlement observed',
      'Settlement confirms recipient processing; it is not bank proof.',
      'Synthetic Route · settlement read',
    ),
    waiting(
      '07',
      'Independent bank evidence matched',
      'No bank credit line has been matched to this obligation.',
      'Synthetic Bank · statement read',
      true,
    ),
    waiting(
      '08',
      'Unique expectation allocation',
      'Allocation cannot run until bank evidence exists.',
      'MoneyTrace · reconciliation',
      true,
    ),
    waiting(
      '09',
      'ERP closure requested',
      'Not requested. Requesting closure is not the same as observing it.',
      'Synthetic ERP · closure request',
    ),
    waiting(
      '10',
      'ERP closure observed',
      'Closure has not been observed in the ERP read model.',
      'Synthetic ERP · closure read',
      true,
    ),
    {
      index: '11',
      title: 'Financial outcome verified / unresolved / reversed',
      status: 'waiting',
      statusLabel: 'WAITING — NOT VERIFIED',
      detail: `Terminal outcome is withheld until stages 7, 8 and 10 are each complete. Exposure remains ${exposure}.`,
    },
  ];
  return {
    bannerTone: 'warning',
    bannerTitle: 'Action acknowledged—not yet financially verified.',
    bannerBody: `Synthetic Route accepted the instruction. An acknowledgement records that a downstream system took the request — it is not evidence that money moved, and exposure is unchanged${partial ? '' : '; independent evidence is still insufficient'}. Stages 5 to 11 are still waiting.`,
    stages,
    blockers: [
      {
        title: 'Missing bank credit',
        detail: 'Stage 7 cannot complete without an independent Synthetic Bank statement line.',
      },
      {
        title: 'Allocation not run',
        detail: 'Stage 8 waits on stage 7; no expectation has been allocated.',
      },
      {
        title: 'Closure not observed',
        detail: 'Stage 10 has no ERP closure record; stage 9 was never requested.',
      },
    ],
    safeConclusion: `The instruction was authorised, reserved once, submitted once, and accepted downstream. That chain is deterministic and auditable. It supports no claim about money having moved, and exposure stays at ${exposure}.`,
    contextualActionNote: `POST /v1/cases/${summary.case_id}/verification-checks at run version ${summary.resource_version}. No Retry or Resubmit exists in this state — the attempt is outstanding and its idempotency key is never regenerated.`,
  };
}

/** Return the verification bundle for any queue case, or `null` if unknown. */
export function buildVerificationTimeline(caseId: string): VerificationBundle | null {
  if (caseId === 'CASE-2077') return CASE_2077_BUNDLE;
  const summary = MOCK_CASES.find((row) => row.case_id === caseId);
  if (!summary) return null;
  return generatedTimeline(summary);
}
