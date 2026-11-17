# Outline synchronization reliability

## Goal
Retain unresolved work and provide direct, safe recovery for outline reads and registry writes.

## Existing architecture
Redux itemList owns editable rows and baseline/conflict snapshots. Controller lifecycle owns selected-document reads and replication events. Store listeners debounce outline and registry writes; persistence utilities validate revisions. Inline ServiceItems notices and the Outlines picker are the existing recovery surfaces.

## Before behavior
Post-conflict edits can outgrow the retained snapshot; session reset drops it. Same-ID load errors have no retry trigger. Reads omit revision metadata. Failed registry intents remain queued with no recovery action and can block unrelated changes.

## After behavior
Unresolved drafts follow outline identity across navigation and controller sessions in this application process. Try again restarts only the selected-outline load. Reads inspect conflict metadata and reuse validated revision reconciliation. Registry errors retain queued intents, expose retry/review, and serialize safe writes per database.

## Product Decision Check
The controller-item-selection and item-document-storage contracts apply. The current October 27 request explicitly authorizes draft retention, in-memory lifetime disclosure, load retry, revision detection/reconciliation, and explicit registry value choices. No unresolved product decisions. No persisted format changes.

## Behavior intentionally unchanged
Local selection versus church-wide active outline, stable row IDs, read-only previews, baseline merge safety, stream/rendering behavior, media/library initialization, and overlays remain unchanged.

## Acceptance criteria
Latest drafts and baselines survive outline/profile navigation and repeated notifications; only confirmed resolution or explicit discard clears them. Failed loads never fabricate empty content. Stale results are ignored across full owner boundaries. Revision branches remain until validated resolution. Failed registry changes remain reviewable; independent safe updates proceed, and successful intents leave the queue without replay or cross-database writes.

## Proposed implementation
Extend existing slice conflict retention and preserve it at session reset. Use a slice retry counter in the existing loading effect. Add a conflict-aware read through the existing revision utility. Extend registry merge with explicit per-conflict choices and a database-owned serialized pending queue behind Redux recovery status. This spans four failure mechanisms; the additional queue/review code is necessary for actionable recovery rather than another persistence source.

## Affected surfaces
Controller, AuxController and OverlayController share lifecycle/store; ServiceItems and the picker expose recovery. Production uses application Redux, ControllerInfo PouchDB/updater, active-controller scope and GlobalInfo access. Tests use real reducers/listeners, faithful provider wrappers, controlled asynchronous boundaries and isolated IndexedDB PouchDB replication. No server/API/auth/display changes.

## Risks / edge cases
Delayed acknowledgments after navigation, edits during resolution, reset to the same outline in another database, repeated losing-leaf events with an unchanged winner, missing common ancestors, new branches during review, and overlapping queue drains. In-memory drafts cannot survive an application restart.

## Questions requiring user input
None.

## Verification
Focused reducer, lifecycle, recovery UI, store-listener, registry utility, real replicated revision-branch and read-only preview tests; TypeScript, lint and client build. Controlled tests cover retry, navigation/reset and branch graph changes. Review the full diff and production composition before handoff.
