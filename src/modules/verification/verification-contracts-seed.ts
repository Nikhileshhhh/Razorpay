import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../config/db.js';
import { verificationContracts } from '../../config/db-schema.js';
import { contentHash } from '../../config/hashing.js';
import { VerificationContract } from '../../contracts/verification.js';

/**
 * Immutable outcome-verification contracts (backend PRD §13, ADR 0002 D7). The
 * four keys match the identifiers the B3 approval decision basis already binds
 * (`VERIFICATION_CONTRACT_BY_TOOL`). Each definition is validated through the
 * authoritative {@link VerificationContract} schema before insertion, so a
 * malformed contract fails loudly rather than seeding a weak one.
 *
 * A `SYNTHETIC_BANK` `BankCreditObserved` is the ONLY authority that can satisfy
 * the transfer contract's amount/currency/identity/time buckets — a settlement
 * ACK or the agent can never satisfy terminal authority (handoff §2.7/§7.4).
 */
type ContractDefinition = ReturnType<typeof VerificationContract.parse>;

const bankAuthority = (field: 'amount' | 'currency') =>
  ({ field, source_system: 'SYNTHETIC_BANK', authority_class: 'AUTHORITATIVE' }) as const;

const TRANSFER_REMEDIATION_VERIFICATION: ContractDefinition = VerificationContract.parse({
  schema_version: '1.0',
  contract_key: 'TRANSFER_REMEDIATION_VERIFICATION',
  version: 'v1',
  economic_subject_type: 'seller_obligation',
  terminal_state: 'EFFECT_VERIFIED',
  required_evidence: [
    'authoritative_transfer_record',
    'recipient_settlement',
    'bank_credit',
    'seller_receivable',
    'seller_receivable_closed',
  ],
  optional_evidence: ['transfer_search_result'],
  blocking_evidence: [
    'transfer_found_with_unresolved_identity',
    'refund_pending',
    'payment_disputed',
  ],
  required_checks: { amount: true, currency: true, identity: true, time: true },
  required_authorities: {
    amount: [bankAuthority('amount')],
    currency: [bankAuthority('currency')],
    identity: [
      { field: 'recipient', source_system: 'SYNTHETIC_BANK', authority_class: 'AUTHORITATIVE' },
    ],
    time: [
      { field: 'value_date', source_system: 'SYNTHETIC_BANK', authority_class: 'AUTHORITATIVE' },
    ],
  },
  tolerances: { amount_tolerance_minor: '0', value_date_window_days: 2 },
  observation_window_seconds: 604800,
  amount_equation_id: 'seller_allocation_rule_contract_v4',
  reconciliation_rule_id: 'one_to_one_bank_expectation_v1',
  reversal_condition_ids: [
    'authoritative_refund',
    'authoritative_reversal',
    'authoritative_dispute',
  ],
  escalation_policy_id: 'unresolved_exposure_escalation_v1',
  expiry_seconds: 2592000,
});

const RECEIVABLE_CLOSURE_VERIFICATION: ContractDefinition = VerificationContract.parse({
  schema_version: '1.0',
  contract_key: 'RECEIVABLE_CLOSURE_VERIFICATION',
  version: 'v1',
  economic_subject_type: 'seller_obligation',
  terminal_state: 'EFFECT_VERIFIED',
  // Closure requires the correlated observed ERP closure after a still-valid
  // allocation; its verified amount is 0 (a state effect, not restored money).
  required_evidence: ['seller_receivable_closed'],
  optional_evidence: [],
  blocking_evidence: ['refund_pending', 'payment_disputed'],
  required_checks: { amount: true, currency: true, identity: true, time: true },
  required_authorities: {
    amount: [{ field: 'amount', source_system: 'SYNTHETIC_ERP', authority_class: 'AUTHORITATIVE' }],
    currency: [
      { field: 'currency', source_system: 'SYNTHETIC_ERP', authority_class: 'AUTHORITATIVE' },
    ],
    identity: [
      { field: 'identity', source_system: 'SYNTHETIC_ERP', authority_class: 'AUTHORITATIVE' },
    ],
    time: [{ field: 'time', source_system: 'SYNTHETIC_ERP', authority_class: 'AUTHORITATIVE' }],
  },
  tolerances: { amount_tolerance_minor: '0', value_date_window_days: 0 },
  observation_window_seconds: 604800,
  amount_equation_id: 'receivable_closure_zero_v1',
  reconciliation_rule_id: 'one_to_one_bank_expectation_v1',
  reversal_condition_ids: ['authoritative_refund', 'authoritative_reversal'],
  escalation_policy_id: 'unresolved_exposure_escalation_v1',
  expiry_seconds: 2592000,
});

const SUPPRESS_RECOVERY_VERIFICATION: ContractDefinition = VerificationContract.parse({
  schema_version: '1.0',
  contract_key: 'SUPPRESS_RECOVERY_VERIFICATION',
  version: 'v1',
  economic_subject_type: 'recovery',
  terminal_state: 'EFFECT_VERIFIED',
  required_evidence: ['recovery_action'],
  optional_evidence: [],
  blocking_evidence: [],
  required_checks: { amount: true, currency: true, identity: true, time: true },
  required_authorities: {
    amount: [
      { field: 'amount', source_system: 'SYNTHETIC_RECOVERY', authority_class: 'AUTHORITATIVE' },
    ],
    currency: [
      { field: 'currency', source_system: 'SYNTHETIC_RECOVERY', authority_class: 'AUTHORITATIVE' },
    ],
    identity: [
      { field: 'identity', source_system: 'SYNTHETIC_RECOVERY', authority_class: 'AUTHORITATIVE' },
    ],
    time: [
      { field: 'time', source_system: 'SYNTHETIC_RECOVERY', authority_class: 'AUTHORITATIVE' },
    ],
  },
  tolerances: { amount_tolerance_minor: '0', value_date_window_days: 0 },
  observation_window_seconds: 604800,
  amount_equation_id: 'suppressed_recovery_prevented_v1',
  reconciliation_rule_id: 'not_applicable_v1',
  reversal_condition_ids: ['authoritative_recovery_rescheduled'],
  escalation_policy_id: 'unresolved_exposure_escalation_v1',
  expiry_seconds: 2592000,
});

const NO_EFFECT_VERIFICATION: ContractDefinition = VerificationContract.parse({
  schema_version: '1.0',
  contract_key: 'NO_EFFECT_VERIFICATION',
  version: 'v1',
  economic_subject_type: 'no_effect',
  terminal_state: 'EFFECT_VERIFIED',
  // REQUEST_MORE_EVIDENCE has no dispatched effect and never produces a
  // verification run; this contract exists only so the decision basis can name
  // a stable verification_contract_key/version.
  required_evidence: ['captured_payment'],
  optional_evidence: [],
  blocking_evidence: [],
  required_checks: { amount: true, currency: true, identity: true, time: true },
  required_authorities: {
    amount: [{ field: 'amount', source_system: 'SYNTHETIC_OMS', authority_class: 'AUTHORITATIVE' }],
    currency: [
      { field: 'currency', source_system: 'SYNTHETIC_OMS', authority_class: 'AUTHORITATIVE' },
    ],
    identity: [
      { field: 'identity', source_system: 'SYNTHETIC_OMS', authority_class: 'AUTHORITATIVE' },
    ],
    time: [{ field: 'time', source_system: 'SYNTHETIC_OMS', authority_class: 'AUTHORITATIVE' }],
  },
  tolerances: { amount_tolerance_minor: '0', value_date_window_days: 0 },
  observation_window_seconds: 604800,
  amount_equation_id: 'no_effect_v1',
  reconciliation_rule_id: 'not_applicable_v1',
  reversal_condition_ids: ['not_applicable_v1'],
  escalation_policy_id: 'unresolved_exposure_escalation_v1',
  expiry_seconds: 2592000,
});

export const VERIFICATION_CONTRACT_DEFINITIONS: readonly ContractDefinition[] = [
  TRANSFER_REMEDIATION_VERIFICATION,
  RECEIVABLE_CLOSURE_VERIFICATION,
  SUPPRESS_RECOVERY_VERIFICATION,
  NO_EFFECT_VERIFICATION,
];

export class VerificationContractConflictError extends Error {
  constructor(key: string, version: string) {
    super(`verification contract ${key}/${version} already exists with different content`);
    this.name = 'VerificationContractConflictError';
  }
}

/**
 * Idempotently seed the immutable verification contracts. Same key/version with
 * identical content is a no-op; same key/version with DIFFERENT content is a
 * seed failure (contracts are immutable — never an update).
 */
export async function seedVerificationContracts(db: DbExecutor): Promise<void> {
  for (const definition of VERIFICATION_CONTRACT_DEFINITIONS) {
    const id = `vc_${definition.contract_key}_${definition.version}`;
    const existing = await db
      .select()
      .from(verificationContracts)
      .where(
        and(
          eq(verificationContracts.contractKey, definition.contract_key),
          eq(verificationContracts.version, definition.version),
        ),
      )
      .limit(1);
    if (existing[0]) {
      if (contentHash(existing[0].definition) !== contentHash(definition)) {
        throw new VerificationContractConflictError(definition.contract_key, definition.version);
      }
      continue;
    }
    await db.insert(verificationContracts).values({
      id,
      contractKey: definition.contract_key,
      version: definition.version,
      definition,
    });
  }
}
