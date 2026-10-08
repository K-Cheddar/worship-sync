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
