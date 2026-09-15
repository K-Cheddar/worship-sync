---
name: persisted-mutation-safety
description: Implement, debug, or review persisted mutations in WorshipSync. Use when an asynchronous client save, autosave, retry, live sync event, or another device can overlap with a write to shared state such as schedules, service plans, roster data, forms, settings, or synced presentation state.
---

# Persisted Mutation Safety

Assume every shared write can overlap with another writer or receive responses out of order.

## Analyze the mutation

1. Identify the authoritative document, every field the request can replace, and the clear/delete semantics.
2. Find all other writers: autosave, bulk actions, background sync, retries, SSE/Firebase listeners, and other windows/devices.
3. Decide whether the operation needs a transaction, compare-and-swap revision, field-level patch, or an idempotency key. Do not rely only on client ordering.

## Persist safely

- Read mutable state inside the transaction or lock that commits it.
- Replace a derived map only from the latest authoritative snapshot; preserve unrelated keys.
- Use datastore transactions for cross-process/device contention. Add a scoped in-process queue only where the local store lacks transaction support.
- Keep authorization, ownership, and current-state validation at commit time.
- Make retries safe: a repeated request must not duplicate, resurrect, or erase data.

## Reconcile safely in the client

- Apply the smallest optimistic change possible.
- Tag mutations with a monotonic sequence or base revision.
- Ignore responses and rollbacks that are older than the latest relevant local mutation.
- Do not let a whole-document response overwrite newer optimistic fields.
- Keep background sync from applying stale snapshots while local saves are pending.

## Verify the race, not only the happy path

Test the applicable cases:

1. Overlapping writes to separate fields preserve both changes.
2. A clear/delete does not restore stale data or remove an unrelated key.
3. A delayed older response cannot replace a newer optimistic update.
4. A second client, window, or sync event receives a consistent final state when the feature is shared.

Run focused tests plus the relevant lint/type/build checks. For schedule-specific work, also use `$schedule-mutation-safety`.
