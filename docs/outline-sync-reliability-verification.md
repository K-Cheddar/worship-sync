# Outline synchronization reliability verification

Branch: `in-progress-3`. Scope: implementation and affected-workflow review of the complete outline synchronization reliability request. This is not a whole-branch production-readiness review.

## Before behavior

Conflict snapshots could lag later edits and disappear during controller teardown. Failed same-ID outline reads had no direct retry. Opening an outline could hide losing CouchDB leaves. Registry failures retained intents without actionable recovery, and a failed batch could block independent edits.

## After behavior and implementation

1. **Draft retention.** Existing `remoteConflicts` now tracks every row mutation, its reconciliation baseline, original notice-time draft and latest remote review. The store retains these records by database name and outline ID across navigation, controller/profile resets, undo/redo and recreated database handles. An acknowledged outgoing resolution uses the retained draft even after its controller has unmounted. Later edits survive that acknowledgment. Stale save errors cannot replace a newer review. Keep my draft retains the current list until acknowledgment; Use remote version is an explicit discard, with a warning about later edits.
2. **Same-outline retry.** Try again increments a retry trigger consumed only by the existing outline-load effect. It targets the current selection, disables duplicate retries, preserves usable content and does not restart unrelated library/overlay initialization. Initial invalidated reads stop after five attempts. Selection, profile and database generations suppress obsolete results before additional branch inspection or hydration.
3. **Saved revision detection.** Initial/switch reads and relevant replication events request `_conflicts`. Only a competing graph loads histories and branch bodies. Existing validated reconciliation handles compatible versions; genuine conflicts use the existing inline workflow even without local edits. Repeated unresolved graphs reuse a bounded review cache. New graphs require fresh validation. View-only controllers report conflicts without writing a reconciliation or offering outline write choices.
4. **Registry recovery.** The existing picker shows Retry save, disputed properties with both values, and explicit Save choices. Live-outline choices are labeled as church-wide changes. Resolution choices require full controller access. Common-ancestor merges preserve independent fields; unavailable/compacted ancestors require explicit property and presence choices. Changed revision graphs or dependent choice values refresh the review instead of committing a value different from the one displayed.
5. **Queue ownership.** The existing per-database queue now has one serialized runtime. Property-level intents allow unrelated safe changes to continue while failed changes stay parked. Newer intents supersede older values, acknowledgments remove only the submitted entry, lost-response retries recognize already committed values, and reorders wait for pending outline creation. Edits accepted during a save or review resume after it finishes. Debounce cancellation does not cancel a started database operation. Database switches suppress old UI/broadcast results and never redirect work to the new church.

## Behavior intentionally unchanged

Runtime operator selection remains distinct from the church-wide active outline. Saved scope selection retains its existing last-writer-wins behavior. Stable occurrence IDs, baseline-aware independent row merges, explicit genuine-conflict decisions, read-only previews, overlay ordering, media preparation and library ownership remain intact. Persisted document shapes are unchanged. No migrations, branch merges, real-data operations or browser-storage drafts were introduced.

## Additional database work

- Initial outline loads still use one ordinary document read, now with conflict metadata. Conflict-free opens do not load histories.
- A new relevant outline replication revision adds an authoritative metadata read; duplicate recent event revisions are skipped. Registry-only changes do not reload the selected outline.
- Competing graphs invoke the existing branch/baseline inspection and validated merge/retirement reads. Unchanged unresolved graphs reuse their full review. Cache eviction is bounded; no polling was added.
- Explicit load retries repeat only the selected-outline read, up to the existing five-attempt stability limit. Initial successful hydration still loads that outline's overlays where needed; usable background content does not restart overlay/history initialization.
- Registry saves read the latest revision for each independent pending property. This isolates failed properties instead of blocking a whole batch. Failures add a read-only recovery review. Registry branch bodies/history are loaded only when conflict metadata reports competing leaves. Explicit resolution rechecks the graph before committing, before retiring leaves and after retirement. Already-applied intents do not create another revision.

## Verification

Main focused command, run from the repository root: **25 suites, 380 tests passed**.

```powershell
npm.cmd test --prefix client -- --runInBand --runTestsByPath src/store/itemListSlice.test.ts src/store/itemListsSlice.test.ts src/store/store.test.ts src/store/allDocsSlice.test.ts src/store/songLibrarySelectors.test.ts src/utils/persistItemListsRegistry.test.ts src/utils/itemListsRegistryQueue.test.ts src/utils/registryRecovery.pouch.test.ts src/utils/persistServiceListField.test.ts src/utils/outlineCrossDeviceSync.pouch.test.ts src/utils/outlineSync.test.ts src/utils/outlineScope.test.ts src/utils/outlineSlideSections.test.ts src/utils/outlineRowSelection.test.ts src/utils/formatItemList.test.ts src/pages/Controller/useControllerPageLifecycle.test.tsx src/containers/ServiceItems/ServiceItems.test.tsx src/containers/Toolbar/ToolbarElements/Outlines.test.tsx src/containers/Toolbar/ToolbarElements/Outlines.recovery.test.tsx src/pages/Controller/Controller.workspace.test.tsx src/pages/Controller/useLiveOutlinePreview.test.tsx src/pages/Controller/ServicePlanOutlinePreview.test.tsx src/pages/Controller/CurrentServiceItemList.test.tsx src/hooks/useOutlineItemDocs.test.tsx src/context/controllerInfo.test.tsx
```

Final picker accessibility assertion follow-up: **2 suites, 6 tests passed**.

```powershell
npm.cmd test --prefix client -- --runInBand --runTestsByPath src/containers/Toolbar/ToolbarElements/Outlines.test.tsx src/containers/Toolbar/ToolbarElements/Outlines.recovery.test.tsx
```

Required gates:

```powershell
npm.cmd run type-check --prefix client
npm.cmd run lint:check --prefix client
npm.cmd run build --prefix client
git diff --check
```

All four required gates passed: TypeScript exit 0; lint exit 0 with no warnings; production/PWA build exit 0; `git diff --check` exit 0. Vite/esbuild needed approved access outside the filesystem sandbox to inspect ancestor directories; the build itself uses the existing production configuration. Builds emit existing bundle-size/asset-resolution warnings.

Test execution exposed pre-existing verification problems: stale song/cache fixtures, missing test diagnostic defaults, nullable/definite-assignment test typing, a missing song-type narrowing in preview hydration, and a replication effect's missing existing dependency. Those were corrected narrowly. Cache assertions still check exact canonical documents and deletion/stale-read behavior; no behavioral expectation was weakened to suppress a failure.

## Code review

### Findings

Critical: None. High: None. Medium: None. Low: None remaining in the affected workflow review.

### Product authorization status

Authorized by the current request and `docs/features/controller-item-selection.md`: draft preservation, same-ID retry, saved-revision detection, safe automatic reconciliation and explicit registry recovery. Read-only behavior preserves the request's read-only guarantees and existing access-tier boundaries. Existing selected/live semantics were preserved. No consequential ambiguity remains.

### Open questions / assumptions

None. PouchDB database names are church-specific in `ControllerInfoProvider`; unnamed test databases use their object identity. Registry operations keep their original concrete database handle.

### Verification gaps and adversarial evidence

Production context: **Pass**. Traced Controller, AuxController and OverlayController into the shared lifecycle, application Redux listeners, active-controller scope, GlobalInfo access and ControllerInfo PouchDB/updater. The real picker integration mounts application Redux, active-controller/mode/toast providers and the owner-aware popover through its actual open/click path. Lifecycle tests use controlled providers and real isolated PouchDB replication; output/media renderers and unrelated library helpers are mocked. Read-only previews and the real Controller workspace have separate regression coverage.

| Invariant | Controlled transition | Code path | Test evidence | Result |
| --- | --- | --- | --- | --- |
| Latest drafts survive ownership transitions | Conflict → later edit → outline/profile switch/reset → return; plus Undo/Redo | itemList matcher, root retained-draft map | `itemListSlice.test.ts`, `store.test.ts` | Pass |
| Acknowledgments cannot erase later work | Keep draft → put pending → later row edit → controller teardown → acknowledgment | outline listener guard and offscreen acknowledgment | `store.test.ts` | Pass |
| Older errors cannot replace newer reviews | Outline read pending → newer remote conflict → old read returns conflicting content | `conflictReviewIsCurrent` | `store.test.ts` | Pass |
| Failed reads are directly recoverable | Initial failure → same-ID retry; pending retry → selection switch | lifecycle retry trigger and identity generation | lifecycle and ServiceItems tests | Pass |
| Saved leaves are visible without edits | Disconnected competing writes → replication before open or after initial load; repeat event | metadata read, cached branch inspection | lifecycle real-Pouch cases, `outlineCrossDeviceSync.pouch.test.ts` | Pass |
| Viewers do not gain write actions | Compatible branches opened/received under view access | read-only inspection and access-gated UI | lifecycle Pouch cases, ServiceItems and picker tests | Pass |
| Review stays bound to what was displayed | Review → third branch arrives; upstream choice changes a dependent value; ancestor compacted | registry review, resolution and leaf retirement | `registryRecovery.pouch.test.ts` | Pass |
| Failed intents do not block safe work or replay | Failed rename → independent edit; superseding edit; put succeeds but response is lost | serialized queue, property intents, no-op recognition | queue tests and store integration | Pass |
| Work cannot move to another church | Registry put pending under A → activate B with same IDs → release A | captured database, guarded Redux/broadcast callbacks | `store.test.ts`, queue isolation tests | Pass |
| Accepted edits do not get stranded | Explicit resolution pending → another edit/debounce → resolution acknowledgment | queue `trackRun` continuation | `itemListsRegistryQueue.test.ts` | Pass |

Optional additional confidence not run: full client/server suites, live multi-device browser/Electron service rehearsal, and CI. No production database was accessed. These are outside the required focused verification.

### Pattern / learning opportunities

Keep recovery state owned by the same long-lived database runtime as its actions. Retain authoritative conflict bookkeeping outside undo snapshots and bind acknowledgments to the submitted draft/review. These mechanisms are local to the affected workflow; no general framework or new persistent draft store was added.

### Final readiness

**Ready.** All required focused verification and gates passed. Review scope is the affected workflow, not deployment readiness.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes; outline/item/overlay persistence, registry bootstrap and read-only preview consumers inspected.
- Legacy/persisted-state compatibility reviewed: Yes; missing new Redux fields are backfilled where needed, existing persisted shapes remain unchanged, compacted ancestors are conservative.
- Identity-switch test reviewed or added: Yes.
- Unmount/lifetime test reviewed or added: Yes.
- Contract round trip traced: Yes; replicated registry/outline fields through persistence, Redux and UI.
- Validate/use security boundary reviewed: Not applicable to URL or authorization transport; no such boundary changed. Revision validate/commit/retire boundaries were reviewed above.
- Retry-state authority reviewed: Yes.
- Owner-retirement handoff reviewed: Yes.
- External side-effect adoption/compensation reviewed: Not applicable; no external resource creation, messaging or compensation added.
- Authorization/data-projection reviewed: Yes; view-only detection and registry-choice access covered.
- Production entry point, runtime context and test composition compared: Yes.

## Limitations

Unresolved drafts and registry pending changes are in memory; closing/reloading/crashing the application cannot recover them. Retained outline drafts survive recreated handles for the same database name. Registry runtimes are tied to their concrete database session and are not transferred to a destroyed/recreated church database. Controller/profile navigation retains the same runtime. No persistent browser storage was added. Additional saved revisions can require another review; unvalidated leaves remain intact.
