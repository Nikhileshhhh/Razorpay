import { eq } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../config/db.js';
import { policyBundles } from '../../config/db-schema.js';
import { contentHash } from '../../config/hashing.js';

/**
 * The immutable `moneytrace_demo_v1` policy bundle (backend PRD §12.2). Its
 * `rules` payload is a human-readable record of the decision matrix that
 * {@link evaluatePolicy} implements in code; the bundle row exists so every
 * `policy_decisions.policy_bundle_version` reference is real, versioned, and
 * append-only (the `policy_bundles` table forbids UPDATE/DELETE).
 */
export const POLICY_BUNDLE_VERSION = 'moneytrace_demo_v1';

export const POLICY_BUNDLE_RULES = [
  { rule: 'REAL_MONEY_AUTHORITY_DENIED', when: 'authority_level = L4', decision: 'DENY' },
  {
    rule: 'CONTRADICTING_EVIDENCE',
    when: 'contradiction_count > 0',
    decision: 'REQUIRE_MORE_EVIDENCE',
  },
  {
    rule: 'INCOMPLETE_EVIDENCE_COVERAGE',
    when: "evidence_coverage != 'complete'",
    decision: 'REQUIRE_MORE_EVIDENCE',
  },
  {
    rule: 'COMPLETE_DUPLICATE_RECOVERY_EVIDENCE',
    when: 'action_type = SUPPRESS_SIMULATED_RECOVERY and evidence complete/uncontested',
    decision: 'ALLOW_AUTOMATIC',
  },
  {
    rule: 'TRANSFER_REMEDIATION_REQUIRES_APPROVAL',
    when: 'action_type = SIMULATE_TRANSFER_REMEDIATION',
    decision: 'REQUIRE_APPROVAL',
    requiredRole: 'finance_approver',
  },
  {
    rule: 'INFORMATIONAL_TOOL',
    when: 'action_type = REQUEST_MORE_EVIDENCE',
    decision: 'ADVISE',
  },
  {
    rule: 'RECEIVABLE_CLOSURE_AFTER_UNIQUE_RECONCILIATION',
    when: 'worker + L3 + zero INR + allocated reconciliation with no closure or reversal',
    decision: 'ALLOW_AUTOMATIC',
    requiredRole: 'worker',
  },
  { rule: 'CURRENCY_MISMATCH', when: 'amount_impact.currency != INR', decision: 'DENY' },
  {
    rule: 'ENVIRONMENT_NOT_ALLOWED',
    when: 'environment not in {demo, buildathon, test}',
    decision: 'DENY',
  },
  {
    rule: 'ACTOR_ROLE_NOT_PERMITTED',
    when: "actor_role has no operational rights (e.g. 'viewer')",
    decision: 'DENY',
  },
  {
    rule: 'MISSING_OR_UNREGISTERED_INPUT',
    when: 'any required input missing/unknown',
    decision: 'DENY',
  },
] as const;

/** Idempotently seed the immutable demo policy bundle (safe to call every startup/seed run). */
export async function seedPolicyBundle(db: Pick<Database, 'insert'>): Promise<void> {
  await db
    .insert(policyBundles)
    .values({
      id: `policy_bundle_${POLICY_BUNDLE_VERSION}`,
      version: POLICY_BUNDLE_VERSION,
      rules: POLICY_BUNDLE_RULES,
    })
    .onConflictDoNothing({ target: policyBundles.version });
}

export async function ensurePolicyBundleExists(db: DbExecutor): Promise<void> {
  const existing = await db
    .select({ version: policyBundles.version })
    .from(policyBundles)
    .where(eq(policyBundles.version, POLICY_BUNDLE_VERSION))
    .limit(1);
  if (!existing[0]) await seedPolicyBundle(db);
}

/** Canonical hash of the bundle content — used to prove the seeded bundle is what code expects. */
export const POLICY_BUNDLE_HASH = contentHash(POLICY_BUNDLE_RULES);
