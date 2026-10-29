# Controller selection implementation and review

Implementation status: COMPLETE

Branch: `in-progress` in the `worship-sync` checkout. Fetched `origin/in-progress` before work; existing two local commits retained. Changes are uncommitted.

## Findings
Critical: None. High: None. Medium: None. Low: None remaining in the reviewed workflow.

Review scope: workflow review and fix verification for the requested controller selection change, not a release-wide readiness review.

## Product authorization status
Authorized by the October 26, 2026 request. [Selection contract](features/controller-item-selection.md) records workspace roots, direct cached activation, legacy redirects, occurrence identity, initialization, auxiliary scope and preserved selection-only actions. Adjacent content-viewing, conflict and countdown contracts remain applicable.

## Before behavior
Item-specific URLs caused route effects to activate documents. Keyboard/continuous selection, tools and media context depended on item routes. Workspace root displayed No Item Selected independently of Redux's active document.

## After behavior
`/controller` and `/aux-controller/:profileId` render the existing workspace. Cached outline mouse/touch, arrow-key and continuous/infinite-scroll selection dispatch synchronously through a shared thunk. Editor/grid/scroller instances remain across cached switches. Actual section navigation remains. Both legacy `item/*` routes redirect to their own workspace, without decoding item IDs. `getControllerItemPath` and route-param activation were removed.

Creation, existing-song Open, Bible activation and media-created items preserve the added occurrence's listId. Canva's retained View action carries a local selection callback and a workspace destination, completing destination teardown before activation and rejecting retired database/church owners. Library Add, read-only details and selection-only actions retain their established semantics.

## Behavior intentionally unchanged
Display transmission, stream transparency, thumbnail renderer/virtualization, media caches and Electron IPC, arrangements, timers, undo policy and standard autosave/conflict ownership. Service-time documents now participate in the existing allDocs cache and reconciliation. No active document state is duplicated.

## Open questions / assumptions
None requiring a product decision. The presentation workspace remains mounted across item switches; actual library/settings sections retain their existing route composition.

## Verification gaps
Required checks: none outstanding. Production-context verification: Pass. `Controller.workspace.test.tsx` uses the real Controller entry, outline rows, Redux store and router with GlobalInfo/ControllerInfo/ActiveController composition; heavy preview/output renderers and unrelated sections are mocked. Actual controller lifecycle and database/cache initialization are exercised separately in their existing suites. Auxiliary route guards, scoped roots and media preparation are covered separately.

Optional additional confidence not performed: authenticated live-browser/Electron hardware operation, exhaustive client/server suites and runtime thumbnail profiling. The thumbnail renderer was not changed. No measurement establishes thumbnails as the dominant remaining delay, so no such claim is made.

| Invariant | Controlled sequence and inspected path | Test evidence | Result |
| --- | --- | --- | --- |
| Cache activation is immediate | Real outline click/arrow dispatches through selectControllerItem and setActiveItem before another route/render effect; no history PUSH, read or loading=true | Controller.workspace and Item cache/mount tests | Pass |
| Selection-only input stays selection-only | No active item, then Ctrl/Shift selection; active item, then modifiers and touch long press; session initializer latches only established selection | Controller.workspace gesture cases | Pass |
| Autosave ownership survives switching | Pending editor mutation A, select B, flush original A; held A save, edit B, reopen A-repeat, then settle writes | store.test deferred-editor and delayed-save cases through actual owner middleware | Pass |
| Conflict state survives occurrences | Dirty A with competing remote doc, reselect then change occurrence without accepting stale cache baseline | Item and store tests | Pass |
| Stale reads cannot activate another owner | Start miss A, select cached B or reset church; separately change database owner without resetting occurrence/cache IDs, then release A | Item deferred-read cases | Pass |
| Retained actions survive route lifetime safely | Create Canva action, unmount Media, simulate destination teardown, invoke View from current cache; reject changed owner and retired session | Media retained View test | Pass |
| Initialization never chooses a substitute | Established occurrence missing while sources initialize; add its exact row later; reset church | Item initialization and controllerInfo/lifecycle suites | Pass |
| Media follows Redux | Change active document for main and auxiliary sources while publisher stays mounted | ControllerMediaPreparationPublisher tests | Pass |

## Verified checks
- Focused Jest: **705 passed, 31 suites, 0 failures**. Run with `npm.cmd test --prefix client -- --watchAll=false --runInBand` and the files below. All directly modified/new tests were run.
- `npm.cmd run test:e2e:controller:fixture-policy`: **7 passed** (fixture cleanup and Home navigation policy; not a live controller browser run).
- `npm.cmd run type-check --prefix client`: passed.
- `npm.cmd run build:strict --prefix client`: passed, including `lint:check` with zero warnings and Vite production/PWA builds. Vite emitted CSS URL and chunk-size warnings. The initial sandboxed build could not read ancestor directories; the authorized elevated rerun passed.
- `git diff --check`: passed. Reviewed complete source/test changes and searched remaining item-route dependencies and callers, including MediaModal and media action flags.

| Focused test file | Passed |
| --- | ---: |
| `client/src/components/DisplayWindow/__tests__/DisplayWindow.corePaths.test.tsx` | 57 |
| `client/src/components/FilteredItems/FilteredItems.test.tsx` | 17 |
| `client/src/components/LeftPanelButton/LeftPanelButton.test.tsx` | 8 |
| `client/src/components/TransferProgress/TransferProgress.test.tsx` | 11 |
| `client/src/containers/Bible/Bible.test.tsx` | 6 |
| `client/src/containers/CreateItem/CreateItem.test.tsx` | 38 |
| `client/src/containers/ItemSlides/ItemSlides.test.tsx` | 47 |
| `client/src/containers/ItemSlides/OutlineItemSlidesScroller.test.tsx` | 18 |
| `client/src/containers/Media/CanvaImportSheet.test.tsx` | 20 |
| `client/src/containers/Media/ControllerMediaPreparationPublisher.test.tsx` | 10 |
| `client/src/containers/Media/__tests__/Media.test.tsx` | 45 |
| `client/src/containers/Media/mediaLibraryActions.test.ts` | 8 |
| `client/src/containers/ServiceItems/ServiceItem.test.tsx` | 3 |
| `client/src/containers/ServiceItems/ServiceItems.test.tsx` | 6 |
| `client/src/containers/Toolbar/Toolbar.test.tsx` | 29 |
| `client/src/containers/Toolbar/ToolbarElements/FormattedTextEditor.integrity.test.tsx` | 19 |
| `client/src/containers/Toolbar/ToolbarElements/SlideEditTools.test.tsx` | 3 |
| `client/src/context/controllerInfo.test.tsx` | 8 |
| `client/src/context/transferContext.test.tsx` | 21 |
| `client/src/hooks/useOutlineItemDocs.test.tsx` | 9 |
| `client/src/pages/AuxController/AuxControllerRoute.test.tsx` | 12 |
| `client/src/pages/Controller/Controller.workspace.test.tsx` | 6 |
| `client/src/pages/Controller/Item.test.tsx` | 11 |
| `client/src/pages/Controller/useControllerPageLifecycle.test.tsx` | 15 |
| `client/src/store/allDocsSlice.test.ts` | 19 |
| `client/src/store/itemLibrarySelectors.test.ts` | 3 |
| `client/src/store/itemSlice.test.ts` | 23 |
| `client/src/store/store.test.ts` | 116 |
| `client/src/utils/itemUtil.test.ts` | 78 |
| `client/src/utils/mediaRouteKey.test.ts` | 11 |
| `client/src/utils/outlineSlideSections.test.ts` | 28 |

## Complexity reassessment
Removed the route loader and URL builder rather than adding a workspace subsystem. The shared selection thunk replaces duplicated scroller/outline activation and retains the established preparation and mutation writer. A small null-rendering session initializer prevents selection-only events from becoming activation and isolates subscriptions below the controller shell. New request tokens identify only asynchronous work, not active item state. No new media cache, routing-based item identity or thumbnail optimization was introduced.

## Pattern / learning opportunities
Regression coverage enforces the route-independent selection boundary and catches media/tool predicates left behind by route removal. No additional repository policy is needed.

## Final readiness
Ready for the reviewed workflow scope.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes; main/aux, both continuous paths, Media/MediaModal/media actions, creation/Open, toolbar and deferred transfer View.
- Legacy/persisted-state compatibility reviewed: Yes; legacy URLs redirect, document shapes and persisted per-kind media-folder keys remain stable.
- Identity-switch test reviewed or added: Yes.
- Unmount/lifetime test reviewed or added: Yes.
- Contract round trip traced: Yes; outline occurrence -> current cached document -> owned active state -> existing editor/autosave.
- Validate/use security boundary reviewed: Yes; captured database, cache session and retired View ownership.
- Retry-state authority reviewed: Yes; existing revision/owned autosave behavior retained and exercised.
- Owner-retirement handoff reviewed: Yes.
- External side-effect adoption/compensation reviewed: Not applicable to new selection behavior; no provider adoption or cleanup semantics changed.
- Authorization/data-projection reviewed: Yes; access gates retained, no new API or public data projection.
- Production entry point, runtime context, and test composition compared: Yes.

Known follow-ups: None required for this change.
