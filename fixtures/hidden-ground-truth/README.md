# Hidden ground-truth labels

**Test and evaluation only.** Files here hold the hidden evaluation labels
(true root cause, required evidence IDs, safe plan, expected policy decision,
required abstention, true exposure/status, expected reconciliation allocation).

They must **never** be imported or dynamically loaded by runtime or model code.

> **Isolation is enforced, not assumed.** Being outside `src/` does **not** by
> itself make this directory unreachable — Node/TypeScript can import across the
> repository with a relative path. The prohibition is enforced by
> `tests/unit/architecture-boundaries.test.ts` (which fails if any file under
> `src/` imports or dynamically imports anything resolving into
> `fixtures/hidden-ground-truth/`) and by a matching ESLint `no-restricted-imports`
> rule. Negative fixture tests in
> `tests/unit/architecture-boundaries-negative.test.ts` prove violations are
> detected.

MT-001 adds no labels; this note reserves and documents the boundary. Later
tasks (MT-010, MT-012) add the labels and any build-time exclusion.
