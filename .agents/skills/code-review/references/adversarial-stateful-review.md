# Adversarial stateful review

Use this method for substantial changes involving async behavior, persistence, synchronization, previews, multi-step work, retries, recovery, or shared state. It adds an independent scenario-generation step to the existing cross-boundary review; it does not replace the repository's persistence, reliable-mutation, or React guidance. Skip it for trivial isolated edits with no meaningful state transition.

## Pass A — derive the contract and scenarios

Do this before using existing tests as a completeness checklist:

1. Name the affected user workflows and trace their entry points through state, persistence, APIs, publication, and recovery.
2. State the important invariants. For each relevant value, identify whether it is authoritative, cached, pending, or acknowledged, and which component, store, database, server, or device owns it.
3. Identify competing actors and operations, including another tab/device, background sync, server requests, and repeated user actions.
4. Derive realistic failure sequences from the workflow and invariants, independently of the patch's test names and comments. Select the highest-risk sequences; do not enumerate every combination. Consult a domain matrix only when the changed workflow intersects it.

## Pass B — challenge the implementation

For each selected invariant, trace the actual code that should enforce it and simulate the chosen sequence through every relevant transition. Track state before and after awaits, writes, acknowledgments, retries, refreshes, and scope changes. Look for a concrete counterexample; then inspect whether a test reproduces that ordering and asserts the user-visible and persisted result. Report `Pass`, `Finding`, or `Unverified`. A test is evidence only for the transition it actually controls.

For important concurrency findings, show an event timeline such as:

```text
local edit B -> save B starts -> local edit C -> save B persists/acknowledges
-> save C settles -> inspect final local state and authoritative persisted state
```

State where the authoritative value came from, what changed during the boundary, and whether the acknowledgment describes the exact write that persisted. Separate a confirmed counterexample from a plausible but unverified risk or missing test.

## Correctness lenses

Apply the lenses that fit the invariant; a structurally valid record alone does not establish correct behavior.

| Lens | Review question |
| --- | --- |
| Data integrity | Are stored documents and references structurally valid? |
| Semantic correctness | Does the resulting data match the operator's intended action and logical structure? |
| Concurrency correctness | Can another valid operation interleave and change or erase the intended result? |
| Acknowledgment correctness | Is a change marked saved only when that exact change is durably persisted? |
| Recovery correctness | Can the workflow resume after refresh or interruption from state that is actually retained? |

## Regression-test evidence

For a confirmed defect, recommend a regression test that reproduces the failure conditions, exercises the competing operation or lifecycle transition, asserts the actual final behavior (including persisted state when relevant), and would fail against the defective implementation. Prefer deferred promises, controlled revisions, and deterministic event order over arbitrary delays. A helper-call assertion alone is insufficient. A review may recommend a test without writing or running it; label tests as existing, proposed, or actually executed, and identify when existing coverage is narrower than the invariant.

## Evidence output

Put a compact table in the skill's existing **Verification gaps** section for the few scenarios that materially affect the review:

| Invariant | Adversarial scenario | Code evidence | Test evidence | Result |
| --- | --- | --- | --- | --- |
| Newer edits survive | Save B overlaps edit/save C | Writer, persistence read/write, and acknowledgment path inspected | Exact controlled ordering test, or missing/not run | Pass / Finding / Unverified |

Use specific paths and symbols (and lines when useful), not general claims. Explain the controlled ordering only when it affects the conclusion. Do not pad the table with low-risk scenarios or mark a row `Pass` because a test with a matching title exists.

## Domain matrix routing

Load the matching reference only when the changed path can affect that workflow, its state owner, or its persistence/API boundary:

- Media Library persistence or folder mutations: [media-library-persistence.md](media-library-persistence.md)
- Portable CSV import, dependency creation, or preview/commit: [csv-import-dependencies.md](csv-import-dependencies.md)
- Invitation SMS consent, challenge, or verification recovery: [invitation-sms-recovery.md](invitation-sms-recovery.md)

For a related but differently named entry point, follow the same domain behavior. Do not review all matrices for an unrelated change. New matrices should use concise scenario/inspection/assertion rows and be linked here only after the domain invariant is established.

The six known missed findings used to calibrate this process are mapped in [adversarial review validation](adversarial-review-validation.md). Use them to check the method itself, not as a requirement to review unrelated workflows.
