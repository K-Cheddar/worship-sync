# Cross-boundary review reference

Use these recurring shapes to identify where a review must follow work beyond the changed function. The main [Code Review skill](../SKILL.md) defines the required review passes and completion checklist.

## Start -> settle

**Failure mechanism:** Work starts for one owner, then settles after church, route, entity, or other state changes. A live handle or identity lookup can redirect a write or stale result into the new owner.

**Review questions:** What full scope and concrete datastore did the operation capture? Which persistence effects may finish for the original owner? Which UI, Redux, or broadcast commits need a current-scope guard? Are success and failure/rollback guarded?

**Regression test:** Use a deferred promise to start under Church A, switch to Church B with the same entity ID, then settle A. Assert B is untouched and any allowed A write or cleanup remains with A.

## Local owner -> global lifetime

**Failure mechanism:** A route/component creates callbacks or state that a longer-lived provider/store retains after the route unmounts.

**Review questions:** Who owns the runtime behind retry/cancel/dismiss? Can the action still be invoked after unmount? Is the action deliberately retired, or does the long-lived owner also own the operation and its state?

**Regression test:** Expose a global action, unmount its creating route, settle or fail the operation, then invoke the action. Assert no dead callback/state update and that global behavior remains coherent.

## Persist -> upgrade -> resume

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

## Async outcome -> operator recovery

**Failure mechanism:** A valid server outcome is ignored, or a terminal/uncertain async state leaves the operator without a safe action or with misleading status text.

**Review questions:** Enumerate the response outcomes the server may validly return, including already-completed or concurrent outcomes. Does each caller consume them? After each request boundary, is pending state immediate and duplicate activation controlled? Can the operator recover from expiration, partial failure, refresh/remount, or interruption? Is a claim such as “active” backed by an actual running signal?

**Regression test:** Make the server return an already-opted-in result during a concurrent consent update and assert the caller follows the idempotent success path. Exercise a delivered code expiring and assert a replacement action is available. Hold a multi-request action pending and assert the UI immediately shows progress and blocks duplicates. For local-source status, verify that presentation distinguishes “configured” from “running” when runtime status cannot be observed.

These are scenario prompts, not a requirement to add a test for every branch in every review. Select the transitions relevant to the change, inspect the actual producer and consumer paths, and report existing test coverage and gaps in the standard review output.
