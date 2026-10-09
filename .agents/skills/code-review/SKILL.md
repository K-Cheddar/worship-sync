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
4. Inspect surrounding architecture, callers, consumers, state ownership, data contracts, analogous features, and tests. For substantial workflows, trace the actual behavior from input through normalization, validation, preview and user decisions (when present), commit, persistence, publication, errors, and retry/recovery. Name the authoritative source at each boundary and verify that values and approved decisions survive the whole path; correctness of each changed function alone is not sufficient.
5. Search for duplicated solutions and existing abstractions that should have been reused.
6. Review lifecycle and failure behavior as applicable: initial load, retries, failures, partial failures, unmount, rapid repeated actions, switching entities during async work, offline/reconnect, stale remote updates, and duplicate events.
7. Review contracts: persisted formats, API shapes, Firebase/Pouch/localStorage, Electron preload/IPC, and backward compatibility.
8. Treat tests as evidence, not proof. Re-check completeness against every acceptance criterion and distinguish required verification from optional additional confidence checks.

For a substantial review involving async work, persistence, imports, previews, retries, synchronization, external resources, durable jobs, destructive cleanup, global actions, or shared state, complete the cross-boundary passes below. Mark irrelevant boundaries not applicable and briefly say why. Use the [cross-boundary reference](references/cross-boundary-review.md) for recurring failure shapes and adversarial scenarios; it supplements this workflow rather than replacing it.

For substantial stateful changes, also complete the two independent passes in [adversarial stateful review](references/adversarial-stateful-review.md). Derive scenarios from the workflow contract before using existing tests to judge coverage. Use only the relevant domain matrix linked from that reference for Media persistence, CSV import, or invitation/SMS recovery; unrelated changes do not require those matrices. Keep isolated, low-risk edits lightweight.

### Required specialized guidance

When applicable, load and apply the deeper domain guidance:

- Shared persisted writes, autosaves, PouchDB/Firebase writes, cross-client contention, or datastore switching: `$persisted-mutation-safety`.
- Multi-stage async workflows, retries, uploads, durable jobs, or identity/lifetime boundaries: `$reliable-state-mutations`.
- React async lifecycle, unmount, or stale-result behavior: `$react-quality` and [stale async work on entity changes](../../patterns/stale-async-entity-changes.md).
- Schedule persistence or mutations: `$schedule-mutation-safety`.

`code-review` orchestrates the review; these specialized guides supply the detailed domain rules. Do not duplicate their contents here.

## Required cross-boundary passes

| Boundary | Questions to answer |
| --- | --- |
| Identity | What stable owner started the work (church, controller profile, service, route, item, media asset, token, or another scope)? What happens if it changes before an await, queued callback, debounce, retry, provider result, or live event settles? An entity/document ID alone is insufficient when it can repeat across owners. |
| Lifetime | Can the creating component or route unmount while work continues? Can a longer-lived owner such as TransferProvider retain its callbacks? Are retry/cancel/dismiss actions valid after unmount? Does cleanup stop the operation or deliberately transfer its ownership? |
| Persistence and publication | Which concrete database, document, and revision belong to each async operation? Is a mutable imported/global DB handle reread after an await, debounce, queue, or callback? At completion, which values must come from a fresh authoritative read, and how are unrelated concurrent changes preserved? Are writes, Redux commits, and broadcasts scoped to the original owner? May a write finish against the original DB while its UI result is suppressed after a scope change? |
| Retry/durable step | Which steps committed durably? Which side effects may have succeeded despite a lost response? Does retry resume from the last durable checkpoint, or can it duplicate upload/send/create/delete work? |
| Compatibility | Can older WorshipSync data or jobs enter this code? Does the client reject a durable shape still supported by server/storage? Is migration complete, partial, absent, malformed, or temporarily unreadable? |
| Destructive/schema | For delete, cleanup, archive, or other destructive work, is the authoritative schema definitely known? Does absent or uncertain schema status preserve data rather than delete it? |
| Input and decision path | How do blank, absent, alternate, or normalized representations flow from input to validation and final mutation? Are valid outcomes and intermediate states handled by every consumer? If there is a preview or approval step, does commit apply the same ownership/resolution rules and all approved choices? |
| Contract round trip | Trace enums, resource types, statuses, wire fields, and provider metadata through `creation -> normalization -> persistence -> API read -> client model -> filtering/presentation`. Does the value survive every step? |
| Validate/use | Can the resource later used differ from the one validated or authorized, and is later use bound to that validation? Consider metadata probe -> proxy GET, permission check -> delayed mutation, signed token -> response type, and preview classification -> actual content. |

For import, preview, or other approval workflows, compare preview and commit as one contract. Check the same resolution and ownership rules, and account for every addition, replacement, preservation, and removal in Merge and Replace modes separately where both exist. Verify that signed or server-validated preview decisions remain bound to the committed settings. On retry after partial success, include IDs and resources created by earlier steps and prove that prior approvals are retained or deliberately refreshed without rejecting valid newly created entities. An omitted destructive consequence in preview is a correctness defect even if commit itself is valid.

For retryable UI flows, identify the source of truth at each stage:

- Before first execution, what owns editable intent?
- After execution begins, what owns the durable runtime?
- After partial failure, can the UI still edit names, items, or options?
- On Retry, does Retry consume those edits or the retained runtime?

If UI state can diverge from a retained runtime after failure, either synchronize the runtime deliberately or freeze the UI for that batch. When the failed UI remains editable, require a transition test that changes a selection, name, or option between failure and retry and proves which values Retry uses.

For user-triggered async flows, follow the operator path through immediate pending feedback and duplicate-action protection, success, partial success, definitive versus uncertain errors, terminal states such as expiration, retry/cancel, and recovery after refresh or remount when relevant. Check that every recoverable failure exposes an accessible next action, that uncertain external side effects cannot be repeated unsafely, and that status wording is supported by an observable signal rather than inferred from an attempted request.

For every globally visible operation whose local owner can unmount, write a retirement matrix before accepting the lifecycle design:

| Concern | After local owner retires |
| --- | --- |
| underlying operation | cancel / continue / hand off |
| Activity entry | remove / remain |
| Cancel | who owns it? |
| Retry failed | who owns it? |
| Retry cleanup | who owns it? |
| Dismiss | who owns it? |
| late success/failure | who publishes it? |

A persistent Activity entry must not become permanently actionless unless it auto-removes. If cleanup can fail after local-owner retirement, its recovery action must live with the longer-lived owner. Dismiss is normally safe to retain in the provider because it does not need route-local business state. Do not retain route-local callbacks merely because Activity remains visible. Require tests for unmount while active followed by late success, late cleanup failure, unmount after terminal completion/failure, and invoking retained actions after unmount.

Retirement must account for recovery needs discovered after the local owner has already retired. Do not determine the detached action set only from failure or cleanup state known at unmount time. Canonical transition: start durable operation -> unmount before provider cleanup begins -> durable app mutation succeeds -> provider cleanup fails afterward -> global Activity gains Retry cleanup -> invoke Retry cleanup after the route is gone.

### Authorization and data projections

For handlers or selectors that return permission-dependent data, trace `auth guard -> permission object -> source document -> derived projections -> nested loaders/lookups -> serialized response`. Ask:

- What is the least-privileged caller admitted by the guard, and what may that caller not read?
- Are there multiple projections such as a plan plus snapshot, details, preview, export, or nested derived object?
- Can a secondary projection reintroduce fields removed from the primary response?
- Does a public-safe sanitizer only filter fields, or does it actually establish authorization? Sanitization is never proof of authorization.
- Can `allowUnpublished`, preview mode, public formatting, or internal rendering bypass a permission check?

Require negative assertions for sensitive readers. For example, a `services:view` caller with no Teams permission may see saved plan content but must not see roster details; a general public link receives only its public projection; a Teams-authorized reader may receive the richer serving-team projection.

### Review test expectation changes as contract changes

A test expectation change is not proof of the new contract. If a test starts expecting more data for a less-privileged user, fewer recovery controls, a different retry target, or deletion of a previously durable external resource, independently derive the intended contract from authorization, persistence, lifecycle, and product rules. Security-sensitive expectation changes need explicit justification. Expectations such as `plan-only reader -> roster details` or `Media unmount -> actions: []` are review signals, not evidence that the behavior is correct.

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
- Does a delayed whole-list/document replacement use a start-time snapshot that can erase unrelated changes made while it was pending?
- Does an operation combine identity captured by React with collections read later from Redux or another source, and can selection change before rerender?
- Does the test reproduce the production transition and meaningful values?

Construct at least one concrete adversarial transition for each relevant failure mechanism, using the reference examples as prompts. Trace the production code path to the expected behavior; a general question, a happy-path test, or a list of risks without a traced outcome does not satisfy this pass. When one instance is found, use its mechanism to search targeted sibling paths before concluding.

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

For substantial stateful reviews, include a compact evidence table here for only the highest-risk scenarios. Each row must name an invariant, concrete interleaving or recovery sequence, code path/symbols inspected, and the specific test that controls the critical transition—or state that coverage is missing or was not run. Mark each `Pass`, `Finding`, or `Unverified`; do not use empty checkboxes or treat test titles as evidence. Distinguish a confirmed defect from a theoretical risk or a coverage gap. A relevant high-risk path left unexamined or required verification left incomplete means `Not ready`; reserve `Ready with minor follow-up` for non-blocking, low-risk follow-up.

State the review scope: **fix verification** checks the reported defect; **workflow review** checks affected end-to-end paths and related failure scenarios; **production-readiness review** checks release-critical branch scope, required checks, unresolved findings, and regression risk. A passing focused review supports only its stated scope. Do not call a branch production-ready unless that broader review and its verification were actually performed; say explicitly when tests, CI, builds, or runtime reproduction were not performed.

### Pattern / learning opportunities

Identify reusable enforcement or documentation opportunities. Follow `.agents/engineering-guidance.md`; do not turn one-off comments into permanent policy.

### Final readiness

Choose exactly one: `Ready`, `Ready with minor follow-up`, or `Not ready`.

Readiness applies to the stated review scope; it is not a production-readiness claim unless the review explicitly covered that scope.

For substantial reviews, append this completion checklist and justify each `Not applicable`. Any relevant `No` prevents a final `Ready` conclusion.

- **Cross-boundary review performed:** Yes / No / Not applicable
- **Sibling-pattern search performed:** Yes / No / Not applicable
- **Legacy/persisted-state compatibility reviewed:** Yes / No / Not applicable
- **Identity-switch test reviewed or added:** Yes / No / Not applicable
- **Unmount/lifetime test reviewed or added:** Yes / No / Not applicable
- **Contract round trip traced:** Yes / No / Not applicable
- **Validate/use security boundary reviewed:** Yes / No / Not applicable
- **Retry-state authority reviewed:** Yes / No / Not applicable
- **Owner-retirement handoff reviewed:** Yes / No / Not applicable
- **External side-effect adoption/compensation reviewed:** Yes / No / Not applicable
- **Authorization/data-projection reviewed:** Yes / No / Not applicable
