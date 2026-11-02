# Data integrity implementation plan

## Goal
Protect existing church data and current drafts across initial replication, overlapping saves, and native plan transfers.

## Existing architecture
ControllerInfoProvider exposes local PouchDB before remote authentication/pull; contentReplicationActivity already owns successful-initial-pull sessions. Bootstrap loaders, Outlines, and useControllerPageLifecycle consume that early database. Redux listeners debounce item and overlay order saves through persistServiceListField. ServicePlanEditor already tracks full editor identity and draft versions for PDF imports. Native transfer reconstructs sections.

## Before behavior
Local 404s seed defaults before remote verification; cancellation leaves persistence running; native imports and confirmations can outlive their draft; reconstruction drops section phase.

## After behavior
Local reads remain available immediately. Automatic missing-document creation requires successful initial replication in the current database session (or guest seeding). A readiness transition refreshes bootstrap consumers. Same-target saves serialize and supersede obsolete intentions without cancelling outgoing-outline saves. Native proposals validate identity/version after loading and at confirmation. Optional valid phases survive transfer.

## Product Decision Check
Authorization: the current four-fix request and docs/features/service-plan-import.md (native one-time copy and explicit replacement confirmation). The request explicitly authorizes bootstrap eligibility, latest-intent persistence, draft protection, and phase preservation. Controller/bootstrap workflow otherwise has inventory-only documentation; this request supplies the specific guarantees. No unresolved consequential product choice.

## Behavior intentionally unchanged
Offline document cache and existing local documents, guest/demo seed, independent items/overlays edits, bounded conflict handling, PDF review behavior, destination ownership/publication, regenerated IDs, foreign ownership stripping, and version 1 remain intact.

## Acceptance criteria
Exercise delayed/failed initial pulls, empty verified churches, offline saved data, church switches, delayed reads/puts/conflicts, outgoing outlines, exact saved acknowledgments, JSON and public imports across draft/identity changes, and pre/main/post plus legacy round trips.

## Proposed implementation
Extend the existing replication session into shared bootstrap eligibility; guard automatic writes and refresh consumers on successful completion. Use a small WeakMap queue keyed by concrete DB/document/field, with supersession checks around reads/writes/retries. Capture import identity/version in one pending object. Preserve and validate the optional phase property.

## Affected surfaces
Browser/Electron ControllerInfoProvider -> Outlines and controller lifecycle -> local PouchDB, replicated documents, Redux, broadcasts. Services route -> ServicePlanEditor -> public download/file read -> confirmation -> draft/undo/autosave. No display-rendering, server API, credential, or permission changes. Tests must use real Redux listeners and real provider session lifecycle where composition matters.

## Risks / edge cases
Replication cancellation must not count as success; progress 100 is not verification. Stale session callbacks must not enable writes. An entered put cannot be aborted, so newer writes must follow it. Independent fields still conflict at document revision level and retry from latest state. Draft counters reset on identity changes; both identity and version must match.

## Questions requiring user input
None.

## Verification
Add deterministic deferred-promise regressions, record fail-before/pass-after when practical, run focused bootstrap/provider/consumer, persistence/listener, native editor/transfer and PDF tests; client lint, type-check diagnostics, and build. Review the complete diff, targeted siblings and production composition, then independently derive and trace the four adversarial review scenarios. Record exact results and gaps in the final review.

## Follow-up: durable outline creation
### Goal / Existing architecture
Outlines awaits createNewItemList before registering/selecting an auxiliary outline. Its detail put is currently detached; the adjacent copy helper has the same final-write defect. PouchDB owns the durable detail; Redux must consume success only after that write succeeds.
### Before behavior / After behavior
Before: any failed get is treated as absence and a pending/failed put can still yield a registry entry. After: only a genuine 404 permits creation, and helper success waits for the detail write. Copy creation keeps its existing null-on-failure result, now including final-write failures.
### Product Decision Check / Behavior intentionally unchanged
Authorized by the current follow-up request and controller-startup-and-saves contract. Preserve naming, scope, existing-document reuse, no-database behavior, initial replication eligibility, and the caller's ownership/cancellation guards. No unresolved product decision or new shared state framework. Manual Add uses the existing Button loading treatment and a local operation owner so failures and retired completions cannot register/select an outline or clear another scope's pending state.
### Acceptance criteria / Proposed implementation
Await both outline helpers' final puts; rethrow non-404 reads in createNewItemList. Prove a rejected auxiliary detail write cannot advance Redux's registry or selection, including while the put is pending.
### Affected surfaces / Risks / edge cases
Automatic auxiliary creation and explicit new/copy actions in Outlines; browser/Electron local PouchDB and Redux. Test pending/success/failure, existing docs and read failures. Copying may already have saved overlay documents before a later failure; do not introduce unrelated cleanup behavior.
### Questions requiring user input
None.
### Verification
Deferred helper tests and the real provider/Outlines/Redux integration must fail before and pass after correction. Run itemUtil, controller bootstrap integration and Outlines tests, client lint/type/build, complete-diff review and the adversarial failed-put sequence. Manual live-device checks are optional.
