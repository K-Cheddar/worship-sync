# Cross-boundary review reference

Use these recurring shapes to identify where a review must follow work beyond the changed function. The main [Code Review skill](../SKILL.md) defines the required review passes and completion checklist.

## Start -> settle

**Failure mechanism:** Work starts for one owner, then settles after church, route, entity, or other state changes. A live handle or identity lookup can redirect a write or stale result into the new owner.

**Review questions:** What full scope and concrete datastore did the operation capture? Which persistence effects may finish for the original owner? Which UI, Redux, or broadcast commits need a current-scope guard? Are success and failure/rollback guarded?

**Regression test:** Use a deferred promise to start under Church A, switch to Church B with the same entity ID, then settle A. Assert B is untouched and any allowed A write or cleanup remains with A.

## Mutation path -> actual guard

For a stateful operation, identify the relevant ways it can start, continue, or change state: controls and dialogs, keyboard or document listeners, programmatic/background callbacks, undo/redo, retries, and async continuations. Trace each path to the service, store, or API boundary that performs the mutation. Verify that the pending-action lock and full owner/target identity are checked there; a disabled or `inert` control does not guard a shortcut, retained callback, or direct invocation.

**Regression evidence:** For the paths that can race with the changed operation, hold it pending and trigger the competing path or switch its owner. Assert that no unauthorized or duplicate mutation reaches persistence. Do not inventory unrelated controls.

## Persisted data -> sibling mutation contract

When a change writes persisted data, find the other relevant endpoints or operations that write the same document, field, or entity. Compare authorization, validation, notifications and message previews, realtime events and public-view invalidation, audit events, replacement/invitation cleanup, and retry/replay behavior where those effects are part of the operation's contract. Equivalent operations should preserve required effects. Treat a difference as a finding only when a confirmed contract or established equivalent-operation behavior requires it; intentional differences need an evidence-based reason.

**Regression evidence:** Exercise the changed mutation and its downstream observable effects, not only the database helper. Check the relevant consumers or emitted messages after success and after a retry/partial failure when applicable.

## Event producer -> least-privileged payload

For a new or changed SSE, websocket, or other realtime producer, inspect the exact serialized payload and who can receive it. Check whether full documents, sensitive fields, public-link tokens, or token hashes escape through the event, and compare the event shape with REST projections. A sanitized REST response does not establish that a separate event is safe. Search sibling producers that publish the same data so a shared exposure is not missed.

**Regression evidence:** Assert the recipient-visible event shape for the least-privileged applicable recipient, including negative assertions for fields that must remain private. Trace the producer and serializer; a helper-only or REST-only test is insufficient.

## Durable commit -> recovery

For a meaningful multi-step mutation, write one concrete failure sequence that begins in a valid state, crosses its durable commit point, and then interrupts a later side effect or loses its response. Identify the durable checkpoint and who owns recovery. Determine which boundaries recovery must survive from the contract and outstanding durable work; verify retry state across navigation, unmount, or process restart as applicable. If the workflow does not recover automatically, check that it reports unfinished effects accurately. Confirm referenced fallback entities still exist and retry will not duplicate completed work. Check whether a request can remain pending indefinitely after its primary mutation committed. For event-driven invalidation, determine whether the contract is based on event-time or delivery-time data and trace delayed delivery to ensure it uses that state rather than a mutable current value.

**Regression evidence:** Drive the committed-write/later-failure ordering deterministically, then verify the recovered persisted state and required downstream effects across the relevant lifecycle boundary. Keep uncertainty about an unbounded wait or recovery guarantee as a risk unless the code path and contract establish a concrete failure.

## Local owner -> global lifetime

**Failure mechanism:** A route/component creates callbacks or state that a longer-lived provider/store retains after the route unmounts.

**Review questions:** Who owns the runtime behind retry/cancel/dismiss? Can the action still be invoked after unmount? Is the action deliberately retired, or does the long-lived owner also own the operation and its state?

**Regression test:** Expose a global action, unmount its creating route, settle or fail the operation, then invoke the action. Assert no dead callback/state update and that global behavior remains coherent.

## Persist -> upgrade -> resume

For a partial-field mutation that feeds an editor/autosave, trace the original comparison baseline, latest persisted revision, pending local intent, and pending remote conflict separately through write and acknowledgment. A full-document response is not permission to replace the full comparison baseline. Test a competing controller edit followed by the partial write and delayed autosave, then both explicit conflict decisions. Also settle an older save acknowledgment after the partial write; it must not restore an older field or acknowledge content it did not persist.

**Failure mechanism:** Current code resumes a durable record written by an older app version or a partially completed migration. A newer required-field assumption can reject valid old work or repeat a completed side effect.

**Review questions:** Which persisted shapes and schema states can exist? What do server/storage still accept? Which durable steps already committed, and where should retry resume when optional newer metadata is absent?

**Regression test:** Load a representative older persisted shape, fail a later step, retry, and assert compatibility plus no duplication of earlier durable work. Include uncertain/partial schema status for destructive cleanup.

## Validate -> use

**Failure mechanism:** A later use acts on a different resource or authority than the earlier validation/classification checked, or the authorization is no longer valid when delayed work executes.

**Review questions:** Can the resource, MIME type, redirect target, range response, permission, token, or preview classification change between validation and use? Is the actual use bound to the validated identity and result?

**Regression test:** Make the probe/permission step and later GET/mutation disagree or change across a controlled boundary. Assert the operation rejects or safely handles the mismatch, including redirects and range behavior where relevant.

## Input -> normalize -> decide -> commit

**Failure mechanism:** A valid input representation is recognized at one stage but dropped by a later branch that checks only a different representation, or validation reports a missing prerequisite and downstream code still dereferences it.

**Review questions:** Trace a representative input field from parsing through normalization, validation, preview, and persistence. Which representations are supported (including blank, absent, ID-only, or alternate-column forms)? Does every consumer use the normalized value? Can an invalid intermediate state reach code that assumes validation succeeded?

**Regression test:** Import an ID-only value with no mapped display name and assert the resolved ID survives the commit. Separately, omit a required destination and assert preview returns a recoverable validation issue without dereferencing a missing entity or aborting unrelated rows.

## Preview -> approve -> commit -> retry

**Failure mechanism:** Preview and commit resolve ownership or matching entities differently, hide a destructive consequence, or lose approved decisions when a prior durable step partially succeeded and the user retries.

**Review questions:** Do preview and commit share the same team/owner resolution? Are additions, replacements, preserved entries, and removals represented for both Merge and Replace? Are signed preview settings still the settings committed? After partial success, does re-preview retain approved actions and accept IDs/resources created by the earlier step?

**Regression test:** Give two teams same-named positions and choose one owning team; compare the preview with the actual Replace mutation. Then let team/position creation succeed before a later step fails, re-preview, and assert prior approvals, signature/settings, and newly created IDs remain valid.

## Identity across preview and commit

Carry each candidate's durable identity and owner from preview through commit. A label, displayed row, or reused raw ID does not establish mutation identity. For bulk ledgers and mixed-operation scenarios, use the single procedure in [adversarial-stateful-review.md](./adversarial-stateful-review.md#bulk-and-mixed-operation-evidence).

Before confirming a finding, name the actual production path, a concrete failure sequence, and the contract or authoritative state that decides expected behavior. If product intent or identity evidence is unresolved, report the uncertainty instead of promoting an implementation preference or a review comment into a defect.

## Async outcome -> operator recovery

**Failure mechanism:** A valid server outcome is ignored, or a terminal/uncertain async state leaves the operator without a safe action or with misleading status text.

**Review questions:** Enumerate the response outcomes the server may validly return, including already-completed or concurrent outcomes. Does each caller consume them? After each request boundary, is pending state immediate and duplicate activation controlled? Can the operator recover from expiration, partial failure, refresh/remount, or interruption? Is a claim such as “active” backed by an actual running signal?

**Regression test:** Make the server return an already-opted-in result during a concurrent consent update and assert the caller follows the idempotent success path. Exercise a delivered code expiring and assert a replacement action is available. Hold a multi-request action pending and assert the UI immediately shows progress and blocks duplicates. For local-source status, verify that presentation distinguishes “configured” from “running” when runtime status cannot be observed.

These are scenario prompts, not a requirement to add a test for every branch in every review. Select the transitions relevant to the change, inspect the actual producer and consumer paths, and report existing test coverage and gaps in the standard review output.
