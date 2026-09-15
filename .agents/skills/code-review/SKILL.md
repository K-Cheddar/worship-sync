---
name: code-review
description: Review WorshipSync changes rigorously before approval. Use for pull-request reviews, implementation self-review, or any change involving correctness, regressions, UX, architecture, performance, security, data integrity, or maintainability risk.
---

# Code Review

Review as if you did not write the code. Do not assume passing tests prove correctness. Do not begin with praise, restrict the review to changed lines, or treat the diff as the whole system.

## Workflow

1. Establish intended behavior from the task or PR description, acceptance criteria, AGENTS.md, and applicable domain guidance.
2. Compare the implementation with its declared Before / After Behavior and unchanged adjacent behavior.
3. Inspect the complete diff.
4. Inspect surrounding architecture, callers, consumers, state ownership, data contracts, analogous features, and tests.
5. Search for duplicated solutions and existing abstractions that should have been reused.
6. Review lifecycle and failure behavior as applicable: initial load, retries, failures, partial failures, unmount, rapid repeated actions, switching entities during async work, offline/reconnect, stale remote updates, and duplicate events.
7. Review contracts: persisted formats, API shapes, Firebase/Pouch/localStorage, Electron preload/IPC, and backward compatibility.
8. Treat tests as evidence, not proof. Re-check completeness against every acceptance criterion and distinguish required verification from optional additional confidence checks.

For async work, identity-tracking refs/state, promises, debounces/autosaves, retries, local and remote persistence, uploads, realtime listeners, session changes, or optimistic/live preview followed by commit, perform an explicit interruption and retry review:

- What happens if the active entity changes while work is pending?
- What happens if a later durable step fails, and what happens on retry?
- Could retry duplicate an already-completed side effect?
- Could a same-entity event invalidate an in-flight load without replacing it?
- Can stale completion overwrite or suppress newer state?
- Are previous-entity decisions accidentally based on current-entity refs or state?
- Does the test reproduce the production transition and meaningful values?

For React code, also review unnecessary derived state; effects used for derivation instead of render or event logic; dependencies; stale closures; async cancellation and races; state ownership; unnecessary rerenders in live paths; unstable objects/functions in hot paths; duplicated local/remote state; cleanup; accessibility; reuse of existing primitives; and mobile behavior.

## Required Review Output

Start with findings, ordered by severity. Do not omit a section; use `None` where appropriate.

### Findings

Group findings as `Critical`, `High`, `Medium`, and `Low`. For each finding include:

- affected file or area
- concrete failure or risk
- why it matters
- suggested direction

### Open questions / assumptions

State unresolved intent or assumptions used in the review.

### Verification gaps

State required verification not completed separately from optional additional-confidence checks. A required gap prevents a `Ready` conclusion and a `COMPLETE` implementation claim.

### Pattern / learning opportunities

Identify reusable enforcement or documentation opportunities. Follow `.agents/engineering-guidance.md`; do not turn one-off comments into permanent policy.

### Final readiness

Choose exactly one: `Ready`, `Ready with minor follow-up`, or `Not ready`.
