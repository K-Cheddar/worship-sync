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

For a substantial review involving async work, persistence, uploads, retries, synchronization, external resources, durable jobs, destructive cleanup, global actions, or shared state, complete the cross-boundary passes below. Mark irrelevant boundaries not applicable and briefly say why. Use the [cross-boundary reference](references/cross-boundary-review.md) for the recurring shapes; it supplements this workflow rather than replacing it.

## Required cross-boundary passes

| Boundary | Questions to answer |
| --- | --- |
| Identity | What stable owner started the work (church, controller profile, service, route, item, media asset, token, or another scope)? What happens if it changes before an await, queued callback, debounce, retry, provider result, or live event settles? An entity/document ID alone is insufficient when it can repeat across owners. |
| Lifetime | Can the creating component or route unmount while work continues? Can a longer-lived owner such as TransferProvider retain its callbacks? Are retry/cancel/dismiss actions valid after unmount? Does cleanup stop the operation or deliberately transfer its ownership? |
| Persistence | Which concrete database, document, and revision belong to each async operation? Is a mutable imported/global DB handle reread after an await, debounce, queue, or callback? Are writes, Redux commits, and broadcasts scoped to the original owner? May a write finish against the original DB while its UI result is suppressed after a scope change? |
| Retry/durable step | Which steps committed durably? Which side effects may have succeeded despite a lost response? Does retry resume from the last durable checkpoint, or can it duplicate upload/send/create/delete work? |
| Compatibility | Can older WorshipSync data or jobs enter this code? Does the client reject a durable shape still supported by server/storage? Is migration complete, partial, absent, malformed, or temporarily unreadable? |
| Destructive/schema | For delete, cleanup, archive, or other destructive work, is the authoritative schema definitely known? Does absent or uncertain schema status preserve data rather than delete it? |
| Contract round trip | Trace enums, resource types, statuses, wire fields, and provider metadata through `creation -> normalization -> persistence -> API read -> client model -> filtering/presentation`. Does the value survive every step? |
| Validate/use | Can the resource later used differ from the one validated or authorized, and is later use bound to that validation? Consider metadata probe -> proxy GET, permission check -> delayed mutation, signed token -> response type, and preview classification -> actual content. |

### Search and compare beyond the diff

For substantial reviews, derive repository searches from the invariant and operation under review. Search likely sibling implementations, not the whole repository without reason. Examples include async listeners, `.then(async ...)`, delayed callbacks, queues, `db.get`/`put`/`bulkDocs`, mutable DB references, Firebase writes; transfer registration/update/retry/cancel/dismiss actions; cleanup/delete/orphan and schema/migration checks; durable job interfaces and persisted IndexedDB records; normalization helpers; and enum creation, filtering, and presentation paths. Once an invariant is relevant, find the other places that implement it. A representative bug is a starting point for this search, not its conclusion.

Actively compare with a known-safe analogue for the same operation. WorshipSync examples include media persistence that captures `dbAtStart`, scope/generation refs that suppress stale Redux commits, and jobs whose runtime belongs to TransferProvider. Compare the ownership, lifetime, queue, and revision checks and understand why they differ; do not copy abstractions without evidence.

### Sibling-pattern expansion

When one confirmed bug represents a reusable failure class, search for sibling instances before concluding. For example: a stale global `db` in one async listener warrants checking other async/debounced/queued Pouch writers; a dead `registerTransferAction` callback warrants checking other global transfer actions backed by route-local ownership; a lost enum warrants tracing creation/read/filter/presentation; schema-unsafe cleanup warrants inspecting other automatic destructive cleanup; old durable-job incompatibility warrants checking other resumable formats; and a MIME probe/use mismatch warrants checking proxied media classes, redirects, and range responses. Do not report one instance and assume analogous code is safe without checking it.

### Transition-test expectations

For async identity and lifetime bugs, normally expect deferred promises or controlled mocks instead of real timing sleeps. Review whether the tests reproduce the production transition and meaningful values. Useful canonical scenarios are:

```text
Church switch: Start under Church A -> hold an async boundary -> activate Church B
-> resolve A -> assert B's DB and Redux state are untouched, and any allowed
write/cleanup remains scoped to A.

Route unmount: Start work -> expose a global retry/cancel action -> unmount its
owning route -> complete/fail later -> verify no dead callback or stale state
update and coherent global action behavior.

Durable retry: Step 1 commits -> step 2 fails -> retry -> assert step 1 is not
duplicated and work resumes at the correct durable checkpoint.

Same ID, different owner: Church A and Church B both contain document/outline
"main" -> switch owners while pending -> verify the guard distinguishes scope,
not just the matching ID.
```

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

For substantial reviews, append this completion checklist and justify each `Not applicable`. Any relevant `No` prevents a final `Ready` conclusion.

- **Cross-boundary review performed:** Yes / No / Not applicable
- **Sibling-pattern search performed:** Yes / No / Not applicable
- **Legacy/persisted-state compatibility reviewed:** Yes / No / Not applicable
- **Identity-switch test reviewed or added:** Yes / No / Not applicable
- **Unmount/lifetime test reviewed or added:** Yes / No / Not applicable
- **Contract round trip traced:** Yes / No / Not applicable
- **Validate/use security boundary reviewed:** Yes / No / Not applicable
