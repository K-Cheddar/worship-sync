---
name: schedule-mutation-safety
description: Implement, debug, or review WorshipSync schedule mutations that update assignments, microphone assignments, guests, position slots, or other persisted schedule maps. Use when a schedule save is asynchronous, optimistic, can overlap with another save, or risks stale responses, lost updates, or accidental restoration of cleared values.
---

# Schedule Mutation Safety

Treat every schedule write as concurrent: another click, browser, device, SSE update, or delayed response may act on the same document.

## Inspect first

1. Identify the exact persisted keys affected, including an explicit clear/delete path.
2. Find every writer of the schedule document or nested map. A targeted endpoint can still be overwritten by a separate full-schedule save.
3. Compare request order, response order, and `updatedAt` when diagnosing a report. Do not infer correctness from a client-side queue alone.

## Server requirements

- Make read-modify-write mutations atomic. In Firestore, read the current schedule and replace the derived map in a transaction.
- Never build an updated nested map from a request-time schedule snapshot outside the transaction.
- If the in-memory/local store has no transaction support, serialize writes per schedule ID and re-read inside the queued task.
- Preserve unrelated slots and occurrences. A clear may remove only its targeted key.
- Keep authorization and validation intact; re-check current document ownership before committing.

## Client requirements

- Optimistically update only the intended schedule state.
- Assign each schedule mutation a monotonically increasing sequence.
- Apply a response or rollback only when its sequence is still current. An older whole-schedule response must not replace a newer optimistic change.
- Serialize dependent writes when later validation depends on an earlier mutation, but do not treat serialization as a substitute for atomic server writes.
- Track saving state by slot or mutation so an older request cannot make a newer edit look complete.

## Required verification

Add focused coverage for both cases:

1. Two overlapping updates to different slots persist both changes.
2. A deferred older response arrives after a newer optimistic selection; the newer selection stays visible and is saved.

Also cover a clear-to-empty-array/no-microphone path when it is part of the change. Run the focused client and server tests, then client lint and strict build. State any remaining cross-device or datastore coverage gap explicitly.
