# Outline revision strategy implementation plan

## Goal
Open and operate the winning outline without converting historical leaves or loading placeholders into operator conflicts.

## Existing architecture
Controller lifecycle reads PouchDB into the undoable item-list slice. Atomic selection activation retires list content; store listeners debounce baseline-aware field saves, retain outgoing drafts and acknowledge exact arrays. Replication notifications refresh the selected document. The registry already follows a winner-only operational policy.

## Before behavior
Master loads the winner without historical branch review. In-progress adds branch inspection on reads and writes, automatic reconciliation/retirement, and large inline revision review. Activation empties the list while retaining loaded identity and baseline; the broad item-list matcher can copy this placeholder into a retained conflict before hydration.

## After behavior
Operational reads hydrate the winner without writes or historical review. Activation retires loaded identity and baseline with content. Ordinary writes compare genuine edits with the current winner and extend that branch using CAS; historical leaves survive. Only overlapping active edits produce focused review.

## Product Decision Check
Applicable contracts: controller-startup-and-saves.md and controller-item-selection.md. The November 11, 2026 request explicitly authorizes winner-only loading/saving, preservation of historical leaves, compact current-edit review and removal of historical maintenance from Controller operation. Update those contracts to supersede the old content-branch policy. No unresolved product choice.

## Behavior intentionally unchanged
Local outline selection, permissions, row identities, outgoing-owner saves, bounded CAS retries, draft retention for genuine edits, presentation, Song V2, service plans and scheduling.

## Acceptance criteria
87/38/38 history loads all winning rows cleanly with no writes. Switching, remount/reset, view-only access and replication cannot turn placeholders into drafts. Disjoint edits merge, overlaps retain work for explicit choices, intentional delete-all persists, and historical leaves remain available.

## Proposed implementation
Remove branch inspection from Controller read paths and ordinary save reconciliation. Retain explicit diagnostic/maintenance utilities separately. Reset existing loaded identity/baseline on activation; require initialized content for remote reconciliation. Replace full-branch rendering with current conflicting rows/settings only. Preserve original conflict baseline for review.

## Affected surfaces
Controller and Aux share the lifecycle; ServiceItems renders review; Redux listeners own saving and broadcasts; PouchDB owns winning documents and historical leaves. Tests compose real Redux/listeners, lifecycle and ServiceItems with real IndexedDB-backed PouchDB; unrelated Firebase/media/display dependencies are mocked. No Electron IPC or output rendering changes.

## Risks / edge cases
Stale responses after selection/database changes, same-owner replication during loading, retained genuine empty drafts, edits during review, failed resolution saves, and disconnected replicas. Extending the current winning leaf preserves other leaves; offline edits on a losing branch remain historical content for separately authorized maintenance, not automatically merged.

## Questions requiring user input
None.

## Verification
Run outlineSync, persistServiceListField, real Pouch conflict/replication, itemListSlice, lifecycle, outlineSwitch, store, ServiceItems/review and selection tests; type-check, lint:check and production build. Add real 87/38/38 Controller regression through the real lifecycle/store and interaction UI, verify no outline writes/removals and preserved leaves. Run final code-review with independent contract-derived adversarial pass and implementation pass. Manual Electron verification is additional runtime confidence after automated checks.
