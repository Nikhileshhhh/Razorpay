import { contentHash } from '../../config/hashing.js';
import type { ModelInvestigationOutput } from '../../contracts/findings.js';
import { FINDING_PLAN_TEMPLATE_MAP } from '../../contracts/plans.js';
import type { ClassifiedEvidenceItem } from './evidence-classification.js';
import type { ModelGateway, ModelGatewayRequest, ModelGatewayResult } from './model-gateway.js';

export const DEMO_GATEWAY_MODEL_ID = 'moneytrace-demo-investigation-gateway';
export const DEMO_GATEWAY_PROMPT_VERSION = 'v1';

/**
 * Deterministic offline investigation gateway (backend PRD §11.1, default
 * selected by `MODEL_PROVIDER=stub`).
 *
 * This is NOT a hosted model: it is pure, deterministic code that classifies a
 * sealed evidence pool by TYPE PATTERN (never by case id, never by free-text
 * interpretation of untrusted evidence content) into exactly one of: a
 * registered FINDING, an `INSUFFICIENT_EVIDENCE` abstention, or a
 * `CONFLICTING_EVIDENCE` abstention. Untrusted evidence text (entity
 * references, source strings) is never interpolated into a prompt or used as
 * control flow — only structured `evidence_type`/count/identity fields
 * influence the outcome, so prompt-injection payloads embedded in evidence
 * cannot change the result. It must be labelled an offline deterministic demo
 * gateway (never presented as a real hosted model) in audit/Data Health.
 */
export class DemoInvestigationGateway implements ModelGateway {
  readonly mode = 'offline_stub' as const;

  async investigate(request: ModelGatewayRequest): Promise<ModelGatewayResult> {
    const output = classify(request);
    return {
      output,
      modelId: DEMO_GATEWAY_MODEL_ID,
      modelConfigHash: contentHash({
        modelId: DEMO_GATEWAY_MODEL_ID,
        promptVersion: DEMO_GATEWAY_PROMPT_VERSION,
      }),
      gatewayMode: 'offline_stub',
    };
  }
}

function byType(
  items: readonly ClassifiedEvidenceItem[],
  type: ClassifiedEvidenceItem['evidenceType'],
): ClassifiedEvidenceItem[] {
  return items.filter((item) => item.evidenceType === type);
}

function recipientOf(item: ClassifiedEvidenceItem): string | null {
  const ref = item.entityReferences.recipient_account_id;
  return typeof ref === 'string' ? ref : null;
}

/** Two transfer records "conflict" when their recipient or amount disagree. */
function transferRecordsConflict(records: readonly ClassifiedEvidenceItem[]): boolean {
  if (records.length < 2) return false;
  const recipients = new Set(records.map(recipientOf).filter((r): r is string => r !== null));
  const amounts = new Set(records.map((r) => r.amountMinor?.toString() ?? 'null'));
  return recipients.size > 1 || amounts.size > 1;
}

function classify(request: ModelGatewayRequest): ModelInvestigationOutput {
  const { pool, controlId } = request;

  if (controlId === 'CTRL-01') {
    const transferRecords = byType(pool.items, 'authoritative_transfer_record');
    if (transferRecordsConflict(transferRecords)) {
      return {
        schema_version: '1.0',
        result_type: 'ABSTENTION',
        abstention_reason: 'CONFLICTING_EVIDENCE',
        summary: 'Transfer records for this seller obligation disagree on recipient or amount.',
        explanation:
          'Two or more authoritative transfer records were found for the same expected ' +
          'obligation but disagree on recipient identity or amount, so no confident finding ' +
          'can be made. The obligation remains open pending resolving evidence.',
        supporting_evidence_ids: transferRecords.map((r) => r.evidenceId),
        contradicting_evidence_ids: transferRecords.map((r) => r.evidenceId),
        missing_evidence_types: [],
        confidence_band: 'low',
        evidence_coverage: 'partial',
        recommended_plan_template_id: null,
      };
    }

    const capturedPayment = byType(pool.items, 'captured_payment');
    const missing: ('captured_payment' | 'paid_order')[] = [];
    if (capturedPayment.length === 0) missing.push('captured_payment');
    if (byType(pool.items, 'paid_order').length === 0) missing.push('paid_order');

    if (missing.length > 0) {
      return {
        schema_version: '1.0',
        result_type: 'ABSTENTION',
        abstention_reason: 'INSUFFICIENT_EVIDENCE',
        summary: 'Required evidence for a missing-transfer finding is not yet available.',
        explanation:
          'The evidence set does not yet include every evidence type required to safely ' +
          'conclude a transfer is missing.',
        supporting_evidence_ids: [],
        contradicting_evidence_ids: [],
        missing_evidence_types: missing,
        confidence_band: 'low',
        evidence_coverage: capturedPayment.length > 0 ? 'partial' : 'insufficient',
        recommended_plan_template_id: null,
      };
    }

    // No authoritative transfer record exists at all, and it is not conflicting
    // (checked above) -> a complete, uncontested missing-transfer finding.
    if (transferRecords.length === 0) {
      const supporting = [...capturedPayment, ...byType(pool.items, 'paid_order')].map(
        (r) => r.evidenceId,
      );
      return {
        schema_version: '1.0',
        result_type: 'FINDING',
        finding_code: 'MISSING_EXPECTED_TRANSFER',
        summary: 'A captured payment has no corresponding seller transfer.',
        explanation:
          'The customer payment was captured and the order is paid, but no authoritative ' +
          'transfer record exists for the expected seller obligation. Recommending the ' +
          'registered transfer-remediation plan template.',
        supporting_evidence_ids: supporting,
        contradicting_evidence_ids: [],
        missing_evidence_types: [],
        confidence_band: 'high',
        evidence_coverage: 'complete_for_finding',
        safe_to_act: true,
        recommended_plan_template_id: FINDING_PLAN_TEMPLATE_MAP.MISSING_EXPECTED_TRANSFER,
      };
    }

    // A single, non-conflicting authoritative transfer record already exists —
    // the obligation is not actually missing; abstain rather than guess.
    return {
      schema_version: '1.0',
      result_type: 'ABSTENTION',
      abstention_reason: 'INSUFFICIENT_EVIDENCE',
      summary: 'An authoritative transfer record already exists for this obligation.',
      explanation:
        'A non-conflicting authoritative transfer record was found, so a missing-transfer ' +
        'finding is not supported by the current evidence pool.',
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
      missing_evidence_types: [],
      confidence_band: 'low',
      evidence_coverage: 'partial',
      recommended_plan_template_id: null,
    };
  }

  if (controlId === 'CTRL-04') {
    const refunds = byType(pool.items, 'refund');
    const recoveryActions = byType(pool.items, 'recovery_action');
    const bankCredits = byType(pool.items, 'bank_credit');

    // A pending recovery action alongside independent evidence the value was
    // already restored (refund or bank credit) is a conflict, not a clean
    // duplicate-recovery-risk finding: which one is authoritative is unclear.
    if (recoveryActions.length > 0 && refunds.length > 0 && bankCredits.length > 0) {
      return {
        schema_version: '1.0',
        result_type: 'ABSTENTION',
        abstention_reason: 'CONFLICTING_EVIDENCE',
        summary: 'Both a refund and a bank credit are present alongside a recovery action.',
        explanation:
          'Independent evidence of value restoration conflicts on which channel actually ' +
          'restored the value, so duplicate-recovery risk cannot be confidently confirmed.',
        supporting_evidence_ids: [...refunds, ...bankCredits].map((r) => r.evidenceId),
        contradicting_evidence_ids: [...refunds, ...bankCredits].map((r) => r.evidenceId),
        missing_evidence_types: [],
        confidence_band: 'low',
        evidence_coverage: 'partial',
        recommended_plan_template_id: null,
      };
    }

    if (recoveryActions.length === 0 || (refunds.length === 0 && bankCredits.length === 0)) {
      const missing: ('recovery_action' | 'refund')[] = [];
      if (recoveryActions.length === 0) missing.push('recovery_action');
      if (refunds.length === 0 && bankCredits.length === 0) missing.push('refund');
      return {
        schema_version: '1.0',
        result_type: 'ABSTENTION',
        abstention_reason: 'INSUFFICIENT_EVIDENCE',
        summary: 'Required evidence for a duplicate-recovery-risk finding is not yet available.',
        explanation:
          'A pending recovery action AND independent evidence the value was already restored ' +
          '(a refund or a bank credit) are both required to safely flag duplicate-recovery risk.',
        supporting_evidence_ids: [],
        contradicting_evidence_ids: [],
        missing_evidence_types: missing,
        confidence_band: 'low',
        evidence_coverage: recoveryActions.length > 0 ? 'partial' : 'insufficient',
        recommended_plan_template_id: null,
      };
    }

    const supporting = [...recoveryActions, ...refunds, ...bankCredits].map((r) => r.evidenceId);
    return {
      schema_version: '1.0',
      result_type: 'FINDING',
      finding_code: 'DUPLICATE_RECOVERY_RISK',
      summary: 'A recovery action is still pending after the value was independently restored.',
      explanation:
        'Value already restored via an authoritative refund/bank credit while a recovery ' +
        'action remains pending would double-collect from the customer if left unsuppressed.',
      supporting_evidence_ids: supporting,
      contradicting_evidence_ids: [],
      missing_evidence_types: [],
      confidence_band: 'high',
      evidence_coverage: 'complete_for_finding',
      safe_to_act: true,
      recommended_plan_template_id: FINDING_PLAN_TEMPLATE_MAP.DUPLICATE_RECOVERY_RISK,
    };
  }

  // Any other control has no registered finding code in this gateway's scope
  // (backend PRD §11.1 defines only these two patterns) — abstain safely
  // rather than invent a code.
  return {
    schema_version: '1.0',
    result_type: 'ABSTENTION',
    abstention_reason: 'INSUFFICIENT_EVIDENCE',
    summary: 'This control has no registered investigation finding in Gate B3.',
    explanation: 'The deterministic gateway only classifies CTRL-01 and CTRL-04 evidence patterns.',
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
    missing_evidence_types: [],
    confidence_band: 'low',
    evidence_coverage: 'insufficient',
    recommended_plan_template_id: null,
  };
}
