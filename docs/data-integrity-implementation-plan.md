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
