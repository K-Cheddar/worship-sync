# Outline revision conflict strategy: implementation and review

Implementation status: COMPLETE.

Branch: `in-progress`, base `e6701783deef286766bcef5ccc054734010d345d`, matching fetched `origin/in-progress`. Comparison: fetched `origin/master` at `58395001ccf0ae75721c54ac6cd72119864aaa87`. Changes remain local; no merge, deployment, or production/demo tenant mutation was performed.

## Root cause

Two separate mechanisms combined:

1. The in-progress lifecycle requested `_conflicts`, called `inspectServiceListRevisions`, and attempted baseline-proven full-document branch reconciliation during initial reads and replication notifications. An unresolved historical graph was passed to `recordOutlineConflict`, even with no local edit. That reducer marked the outline pending and retained its current list as a draft. ServiceItems then mounted the full historical-revision reviewer. Master read and hydrated the winner without this maintenance workflow.
2. Content activation set `list = draft ?? []` but left `loadedOutlineId` and, when there was no retained baseline, `syncBaseline` associated with the previous content. Subsequent `itemList/*` actions ran the broad matcher, which copied the loading placeholder into the retained conflict under the stale ID. Remote reconciliation could also accept that uninitialized list and compare it as local deletions. On returning/hydrating, `initiateItemList` preferred the previous list when the stale loaded ID matched, or used the already-corrupted conflict draft. Reconciliation therefore preserved an empty deletion candidate rather than simply displaying the valid winner. This is a lifecycle/ownership defect; the database's 87 winning rows need not have been empty or lost.

Confirmed reproductions against the original HEAD sources:
- The new real-PouchDB 87/38/38 initial-load test failed because `hasPendingUpdate` became true without an edit.
- The new activation/retained-draft reducer test failed because the genuine `My draft` array was replaced with `[]` after loading-state actions and an old-outline callback.

Both reproduce the regression mechanisms. No claim is made that a production database was inspected or repaired.

## Before behavior

Master used the winning outline for ordinary operation. The regression treated historical saved branches as active operator conflicts, sometimes performed maintenance on reads, and exposed full competing outlines and metadata in the sidebar. Once placeholder content contaminated retained conflict state, hydration could leave the Controller empty.

## After behavior

Controller initialization and replication read and display the winning document without branch inspection, reconciliation writes, branch retirement, or a historical-conflict notice. Activation retires loaded identity and baseline together with content. Uninitialized remote updates cannot become local deletions, and stale replication completions are checked against current Redux selection/load generation.

Only genuine unresolved current edits produce review. The compact review renders conflicting fields/rows, a disclosure for changed order positions, and bounded replaced-row summaries for ambiguous current replacements. It never lists historical versions or raw asset metadata. Compatible edits stay in the candidate. The visible draft remains until the chosen result is acknowledged; failed choices remain retryable. Choices are invalidated when the reviewed saved content changes, including while another outline is selected.

## Behavior intentionally unchanged

Local selection and controller scopes, genuine empty-outline edits, row identities, permissions, outgoing-owner saves, bounded revision retries, undo/redo draft protection, and current application-session draft lifetime. Song V2 schema/persistence, scheduling, Service Plan implementation, output rendering, and Electron IPC were not changed.

## Implemented

- Removed historical inspection and conflict creation from ordinary Controller reads and replication callbacks.
- Removed historical merge/retirement from ordinary item and overlay-order saves.
- Made explicit revision inspection read-only. Existing explicit graph-validated maintenance utilities remain separate and tested; no maintenance UI was added.
- Corrected activation identity/baseline ownership and prevented uninitialized remote reconciliation from touching drafts.
- Retained the original three-way conflict baseline for focused review; kept the latest winner as the save/undo baseline.
- Reused the existing pending-resolution payload to retain choices independently from the visible unsaved draft.
- Updated feature contracts and the existing outline synchronization release note.

## Persistence safety

Ordinary item saves capture the database, outline, draft and baseline, serialize same-field local writes, re-read the current winner, reconcile intended row changes, and write using that winner's `_rev`. A 409 retries the existing bounded lane against a fresh winner. Overlapping field edits, incompatible order, and delete/edit conflicts retain work for review. Other document fields come from the current winner. Ordinary overlay-order saves retain their existing field-only replacement semantics.

Historical leaves are neither imported into the operational draft nor deleted. Their presence alone cannot redirect a save into maintenance. The installed PouchDB `winningRev`/`collectConflicts` implementation selects nondeleted leaves by generation and revision-ID ordering, not edit time. Extending the winner creates a new descendant while other leaves remain available and replicate normally. The real-replica tests verify that saving and subsequent replication preserve those leaves and their bodies. A disconnected operator can still create another losing branch; this policy preserves it for separately authorized maintenance rather than promising automatic recovery of every offline saved version.

## Verified (required)

Final focused command, from the repository root:

```powershell
npm.cmd test --prefix client -- --runInBand --runTestsByPath `
  src/utils/outlineSync.test.ts `
  src/utils/persistServiceListField.test.ts `
  src/utils/outlineCrossDeviceSync.pouch.test.ts `
  src/utils/outlineConflictSafety.pouch.test.ts `
  src/store/itemListSlice.test.ts `
  src/store/store.test.ts `
  src/store/itemListsSlice.test.ts `
  src/pages/Controller/useControllerPageLifecycle.test.tsx `
  src/pages/Controller/outlineSwitch.integration.test.tsx `
  src/pages/Controller/outlineHistoricalRevisions.integration.test.tsx `
  src/containers/ServiceItems/ServiceItems.test.tsx `
  src/containers/ServiceItems/OutlineRevisionReview.test.tsx `
  src/pages/Controller/Controller.workspace.test.tsx `
  src/pages/Controller/Item.test.tsx `
  src/pages/AuxController/AuxControllerRoute.test.tsx `
  src/containers/Toolbar/ToolbarElements/Outlines.test.tsx `
  src/containers/Toolbar/ToolbarElements/Outlines.recovery.test.tsx `
  src/context/controllerBootstrap.integration.test.tsx
```

Result: **18 suites passed; 427 tests passed**. No full repository suite was claimed.

Additional checks:

```powershell
npm.cmd run type-check --prefix client
npm.cmd run lint:check --prefix client
npm.cmd run build --prefix client
git diff --check
```

Type checking, lint, the final production build (including PWA generation), and diff whitespace checking passed with exit code 0. The initial build was blocked by sandbox access to parent directory metadata; the approved unrestricted retry succeeded. Existing Vite asset/chunk warnings are nonfatal and unrelated to this patch.

Test evidence covers all requested categories:

| Category | Evidence |
| --- | --- |
| A: historical initial load | Real IndexedDB-backed PouchDB fixture with 87-row winning descendant and two 38-row losing leaves; real lifecycle/store/listeners/sidebar; clean pending state, no draft or review, unchanged winning revision, no operational writes/removals |
| B: switching | Same fixture switches to another outline and back; loaded ID/baseline retire atomically and the 87 rows return |
| C: remount/reset | Same fixture unmounts/remounts and executes full reset; reducer regression also protects a genuine retained draft from temporary empty state |
| D: replication | Second replica writes a descendant of the winner; replication notification refreshes all winning rows with no historical UI or outline writes |
| E: concurrency | Independent replicas with historical leaves: disjoint active edits merge; overlapping active edits fail without writes and preserve the local draft; losing leaves remain readable. Real Controller review additionally covers failed choice, retry and durable acknowledgment |
| F: delete-all | Initialized populated Controller uses `removeItemsFromList`, persists an empty array, then clears pending state. Reducer also preserves authored emptiness across owner activation |
| G: view-only | Real 87/38/38 lifecycle/sidebar fixture with view access; no operational writes, branch removal or review |

Production-context verification: **Pass for the affected workflow**. Inspected Controller and Aux entry points, shared lifecycle, App's timezone provider, ControllerInfo database activation/notifications, GlobalInfo access tiers, Redux owner middleware and save listeners, ServiceItems and deferred order review. New integration tests use the real lifecycle, Redux store/listeners, PouchDB, router, timezone provider and sidebar. They mock row thumbnails, registry picker and unrelated media/Firebase/bootstrap services. Existing bootstrap integration separately uses the real ControllerInfoProvider, while Controller.workspace and Aux route tests cover composition. Tests use synthetic databases and destroy them afterward.

## Code review

Scope: **workflow review / fix verification**, not release-wide production-readiness approval. **Entire change set inspected**, including new integration tests, contracts and release-note changes. Used the repository code-review skill with contract-derived adversarial scenario generation followed by an implementation challenge pass.

### Findings

Critical: None. High: None. Medium: None. Low: None requiring a change before manual verification.

Confirmed issues found during implementation were corrected: historical conflict promotion, placeholder draft corruption, undo baseline confusion, stale replication ownership, and reuse of a retained choice after an unseen winner change. The report does not elevate speculative failures into defects.

### Product authorization status

Authorized by the November 11, 2026 request. The affected contracts now record winner-only operation, preservation of historical leaves, and focused protection of genuine current edits. Existing tests expecting automatic historical merge/retirement were deliberately changed because that behavior is explicitly disallowed by this request. Explicit maintenance safety tests remain.

### Open questions / assumptions

No unresolved product decision. Historical leaves may contain valuable or later edits; no ordering-by-edit-time assumption is used.

### Verification gaps

No required automated verification gap. Optional manual Electron/controller verification has not been performed, and no real tenant was opened. Synthetic databases establish the behavior but do not prove the condition of a particular deployed tenant.

| Invariant | Production owner / consumer and writer | Adversarial boundary | Executed evidence | Result |
| --- | --- | --- | --- | --- |
| Loading is not deletion | Item-list owner activation, lifecycle, store autosave | Retained conflict -> switch -> empty loading action -> stale old-outline remote callback -> return | itemListSlice activation regression; outlineSwitch integration; 87/38/38 integration | Pass |
| Winner loads without maintenance | PouchDB winner -> lifecycle -> ServiceItems | Historical leaves exist on first load; switch/remount/reset with no authored edit | 87/38/38 full/view cases; six lifecycle historical-event cases | Pass |
| Authoritative edits survive | Captured DB/outline and field save lane -> PouchDB | Competing winner edit -> save local disjoint/overlapping draft; existing leaves remain | outlineCrossDeviceSync real replicas; persistServiceListField controlled CAS/queued tests | Pass |
| Reviewed choice is current | Review action -> reducer -> pending payload -> save/ack | Saved content changes before dispatch or during navigation; save fails and retries | itemListSlice stale-saved-choice/retained-choice tests; Controller failed-choice integration | Pass |
| Owner cannot redirect results | Controller/Aux identity and captured DB -> Redux/listeners/broadcast | Delayed original-owner read/save settles after outline/database switch | outlineSwitch integration; lifecycle stale/switch tests; store ownership tests | Pass |
| Exact intent is acknowledged | Pending array/draft baseline -> store acknowledgment -> Redux | Earlier save settles after later edits; undo/redo while conflict retained | store tests; itemListSlice tests; focused resolution integration | Pass |

Coverage ledger:

| Workflow / changed path | Production path / downstream consumer | Tests inspected and executed | Skipped area / reason |
| --- | --- | --- | --- |
| Read/activation/replication | Controller and Aux -> lifecycle -> item-list slice -> sidebar | lifecycle, outlineSwitch, historical integration, itemListSlice, bootstrap integration | Physical Electron windows: optional runtime verification |
| Save/review/acknowledgment | ServiceItems review -> reducer -> store listener -> field save -> PouchDB -> state/broadcast | ServiceItems, OutlineRevisionReview, store, persistServiceListField, outlineSync, both real-Pouch suites | Actual cloud tenant replication: no tenant data authorized for mutation |
| Selection and adjacent composition | ItemLists/picker, Controller workspace, Aux route, item activation | itemListsSlice, Outlines/recovery, Controller.workspace, Item, AuxControllerRoute | Output renderers and Song V2 internals unchanged |

### Pattern / learning opportunities

The existing ownership generation and pending-resolution payload were sufficient. Removing read-path maintenance and resetting content identity fixes the source of the problem without a new recovery database, polling loop, retry subsystem or persisted state machine. The new regression tests enforce this boundary.

### Final readiness

**Ready** for manual Electron/controller verification of the affected workflow. This is not authorization to merge or deploy.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes; registry winner policy, overlay-order saves, Aux and lifecycle consumers.
- Legacy/persisted-state compatibility reviewed: Yes; persisted outline document shape unchanged, historical leaves retained.
- Identity-switch test reviewed or added: Yes.
- Unmount/lifetime test reviewed or added: Yes.
- Contract round trip traced: Yes.
- Validate/use security boundary reviewed: Yes; full/view rendering and captured-owner write paths; no new permission model.
- Retry-state authority reviewed: Yes; snapshot checks, bounded CAS, retained draft and selected-result acknowledgment.
- Owner-retirement handoff reviewed: Yes; existing outgoing-owner save lane and retained drafts.
- External side-effect adoption/compensation reviewed: Not applicable; no external resource creation/deletion added.
- Authorization/data-projection reviewed: Yes; view-only fixture and no raw metadata in review.
- Production entry point, runtime context and test composition compared: Yes.

## Not verified (optional)

Manual Electron/controller exercise against a disposable representative database, including sidebar usability and multiple physical windows. No production/demo tenant data was modified for verification.

## Known follow-ups

None required for this implementation. Historical revision cleanup remains a separate, explicitly authorized maintenance concern.

## Final recommendation

The change restores normal winning-outline operation in the regression tests, preserves historical leaves and genuine unsaved work, and is ready for manual Electron/controller verification. Do not merge or deploy as part of this task.
