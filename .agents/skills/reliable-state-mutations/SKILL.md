---
name: reliable-state-mutations
description: Implement or review WorshipSync async workflows that cross identity boundaries, have multiple durable side effects, or must survive interruption and retry without stale or duplicate state.
---

# Reliable State Mutations

Use this skill for async work whose owner can change, multi-stage mutations with partial success, or stateful workflows involving retries, live events, autosaves, uploads, synchronization, or optimistic preview and commit.

Keep the solution local and straightforward. Do not introduce a state machine, queue, or new abstraction unless the existing workflow actually requires it.

## Async work belongs to its original owner

Async work must make decisions using the identity and state of the entity that started it, not mutable current-entity state that may now describe something else. A pattern such as this is unsafe:

```ts
currentVersionRef.current = newEntity.version;

flushPreviousWork(() => {
  if (currentVersionRef.current <= savedVersion) return;
});
```

The pending work for the previous entity is now consulting state already updated for the next entity. Capture the necessary identity, version, payload, base revision, and completion behavior with the pending operation itself, or use an equivalent existing representation:

```ts
pendingWork = {
  entityId,
  version,
  payload,
  baseRevision,
  save,
};
```

Treat identity changes as lifecycle boundaries. Ignore stale display results where appropriate, but deliberately complete, preserve, or cancel pending unsaved work. A cancellation or stale-result guard alone does not make a shared write safe; use the relevant persisted or schedule mutation guidance. Include realistic identity resets in tests, including counters or versions returning to zero.

Guard commits using the full ownership scope, not only the entity ID. If the same ID can exist under two churches or tenants, a matching ID does not make a result current.

### Long-lived action ownership

If a long-lived provider/store exposes retry, cancel, or dismiss actions, the runtime backing those actions must also live in that long-lived owner or be deliberately retired when the original owner unmounts. Do not leave globally visible actions backed by closures into dead route/component state. Test the exposed action after the creating route has unmounted.

## Identify durable commit points

Break multi-stage mutations into meaningful steps and mark which steps are durable:

```text
1. create local asset            <- durable
2. create or update local record <- durable
3. perform remote operation      <- may fail
4. attach remote result          <- durable
```

Ask: if step 3 fails and the user retries, which earlier steps are safe to repeat? A retry should normally resume after the last durable commit point. Do not repeat a completed mutation merely because a later step failed; distinguish durable completion from a lost response, an unknown outcome, and an operation that never ran. Apply this reasoning to autosave, media import/upload, scheduling, publishing, invitations/email, session reset or rotation, local/remote synchronization, and drag preview followed by commit.

For persisted/resumable jobs, account for shapes written by older app versions and compare current client assumptions with server/storage compatibility behavior. Do not restart or duplicate a durable side effect merely because a newer optional field is absent.

### Provider-result adoption and compensation

Trace external results through their ownership steps:

```text
created -> durably checkpointed -> adopted/referenced by application state
```

Compensating deletion is safe only while the provider result is still unadopted and orphaned. Identify the exact durable step after which deletion could break an application reference. Once the result may be referenced by durable state, preserve it under ambiguity, suppress stale UI/Redux commits, and continue or park the original owner's workflow. Never delete an adopted result merely because the active UI scope changed, and never redirect cleanup to the newly active church.

For a fresh provider result that has not been adopted, cleanup may still be correct after an owner change, but it must target the original provider/church. Test both sides of this boundary. Canonical adopted-result regression:

```text
provider step succeeds
-> application adopts/checkpoints result
-> later durable step fails
-> retry begins
-> owner changes
-> assert adopted provider result is preserved
```

## Review interruption boundaries

Trace the workflow through the transitions that can expose stale, lost, or duplicated state:

- What if the active entity changes while work is pending?
- What if a request succeeds but its response is lost?
- What if a later step fails after an earlier durable mutation succeeds, and what exactly does Retry do?
- What if the same live event arrives twice, or another arrives while initial loading is in flight?
- Which values belong to the previous entity versus the current entity?
- What prevents stale completion from replacing newer state?
- Could a same-entity event invalidate an in-flight load without replacing it?
- Is there a regression test for the transition using the production-relevant values?

Prefer focused tests with deferred promises, controlled failures, duplicate events, and explicit identity changes. Verify both success and failure paths, and preserve existing cancellation, persistence, synchronization, and operator behavior outside the changed boundary.

When a failed batch remains editable, test a selection/name/option change between failure and retry and verify whether Retry uses synchronized intent or a deliberately frozen retained runtime.

For shared persisted writes, also use `$persisted-mutation-safety`; for schedule maps, use `$schedule-mutation-safety`; for React lifecycle details, use `$react-quality` and the [stale async work pattern](../../patterns/stale-async-entity-changes.md).
