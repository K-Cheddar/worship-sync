# Outline switching integrity

## Goal
Load the selected outline without confusing outgoing drafts with the new owner.

## Existing architecture
The controller lifecycle reads details and overlay documents into shared Redux slices. Registry reducers can select via explicit selection, scope changes, initialization, removal, or remote reselection. Store listeners debounce fields and persist through database/document/field lanes with bounded conflict retries. Existing item mutations demonstrate concrete-database ownership and separate persistence from UI completion.

## Before behavior
Unowned dirty flags skip a different outline's load; outgoing rows can remain under the new selection. Only explicit selection flushes outgoing fields. Empty overlay initialization leaves stale bookkeeping. Reads and save completion need owner checks beyond the visible document ID.

## After behavior
Selection changes synchronously retire old content and binding. Same-owner refresh retains pending drafts; different owners initialize independently. Unsaved outgoing drafts remain recoverable on rapid return. Saves finish on the original database, while only the matching active snapshot may be acknowledged/published. Empty overlays fully initialize without resetting history.

## Product Decision Check
Authorized by the current request's seven requirements and `docs/features/controller-startup-and-saves.md`. This restores safe outline editing; no persisted schema, permissions, or presentation changes. Retain only unsaved per-owner drafts in existing slices; do not add a general state manager. No unresolved consequential choices.

## Behavior intentionally unchanged
Scoped field save serialization, conflict retries, debounce for ordinary edits, offline reads, initial-pull eligibility, and remote-update draft protection.

## Acceptance criteria
Exercise every requested A/B transition with real reducers/listeners and controlled DB reads/writes. Assert displayed content, binding, flags, original-document persistence, and suppressed stale publication. Demonstrate regression failure before correction.

## Proposed implementation
Tag the existing content slices with a concrete-database/outline key. Scope changes resolve selection through the existing registry; the same document remains the same draft owner if its scope metadata changes. At the root reducer boundary, reset content and binding atomically for all selection paths. Retain pending arrays per owner in those slices and acknowledge only the exact persisted array. Keep existing persistence lanes. Guard lifecycle reads using store ownership and a transition generation as well as effect cleanup, including before React rerenders.

The focused fix exceeds the 50–100-line warning threshold because it must address three independent boundaries: atomic content retirement for every selection path, recovery of unsaved arrays during rapid return, and exact save acknowledgments. A helper-only dirty-flag bypass would leave editable stale content during reads and lose returning drafts. New runtime state is limited to ownership/generation and unsaved arrays in existing slices, plus the selected overlay's owner; there is no new save manager, retry engine, or persistent schema. The overlay editor remains mounted but hidden/disabled when retired so its accepted local draft is not discarded; its original DB is retained for that completion.

## Affected surfaces
Controller and auxiliary controller lifecycle, registry reducers, service items and overlays, service-plan binding, PouchDB field saves, and cross-tab publication. Tests mount the actual lifecycle with a subscribed Redux provider and real store listeners; unrelated media/bootstrap APIs are controlled. No server, IPC, display composition, authentication, or wire schema change.

## Risks / edge cases
Same-ID databases; selection without rerender; A/B/A delayed reads and writes; edits during refresh; empty lists; failed reads and writes; scope reselection; stale remote overlay reads; undo across owners. Pending persistence continues after retirement; stale UI results are suppressed. No new Activity or external resource lifecycle.

## Questions requiring user input
None.

## Verification
Required: fail-before/pass-after controlled lifecycle integration regressions; item/overlay/registry reducers; store persistence and conflict helper suites; existing lifecycle/bootstrap/remote overlay regressions; client lint, type-check, production build, and diff check. Review full change using code-review and persisted-mutation guidance, with an independent adversarial pass. Optional: live multi-device/browser/Electron smoke and exhaustive repository suites.
