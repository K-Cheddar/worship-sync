# Item storage handoff and review

Implementation status: COMPLETE

## Before behavior

`allItems` was a persisted metadata index, a Redux library list, a loading/readiness flag, and the owner of search/filter controls. Index repair merged document libraries back into it. Item mutations maintained both the index and documents. Controller replication/broadcasts and Services/Resources initialization independently refreshed the full document cache. Outline previews also retained a second fallback document map. Stale index metadata could override saved names/backgrounds, and asynchronous reads could replace newer data.

## After behavior

PouchDB persists and replicates actual item documents. The shared `ControllerInfoProvider` initializes `allDocs` from one local snapshot, including its `update_seq`, and attaches one live feed starting at that sequence. Writes during loading are replayed. Local writes and incoming replication use the same incremental upsert/deletion reducer. Feed retry resumes at its last delivered sequence. Cleanup cancels the feed/retry and invalidates pending work. Church, user, database and full Redux-session changes retire the old cache owner; a Controller route reset retains the shared cache.

Local content opens before remote authentication/initial replication completes. Libraries, search, duplicate detection, media creators, Bible uniqueness checks, navigation, preview scrolling, Planning URL import and saved-plan insertion read cached documents. Normal loaded navigation performs no Pouch reads. Genuine misses retain guarded reads into `allDocs`; they cannot replace newer cached content or resurrect a processed tombstone. There is no separate preview document cache.

Search/filter controls now live in `itemLibraryUi`, containing no item list or persistence. All library categories share one metadata adapter, preserving saved names/backgrounds and local media references from documents/slides. Song selectors subscribe only to song documents so Bible/heading changes do not invalidate song matching.

## Behavior intentionally unchanged

Pouch revision conflicts, captured autosave ownership, pending drafts, remote edit buffering and explicit conflict decisions remain intact. Outlines own ordering, occurrence `listId`s and their overrides. Library updates do not refresh existing outline backgrounds. Newly inserted service-plan references take current library metadata after asynchronous work. The generated next-service countdown remains separate from saved timers. Overlay synchronization, song migrations, Firebase publication and display rendering were not redesigned; stream transparency is unchanged.

## Removed paths

- `allItemsSlice`, its actions and initialization, its autosave indicator key, its debounced Pouch persistence listener and its import-preview listener.
- `songLibraryIndexRepair` middleware and index reconciliation utilities/tests for songs, custom documents and timers.
- The index/document merge selectors and redundant manual cache/index updates in creators, saves, deletion, audio and local-image handlers.
- Controller/Services index bootstrap and Controller/Services/Resources `updateAllDocs` refresh paths, including refreshes on item replication/broadcast events.
- Manual allDocs upsert/remove/media-patch actions, category-wide refresh actions, the old `formatAllItems` writer and the extra preview-document cache/merger.

The subsequent item-cache review removed automatic Bible/heading cleanup and its unused utilities. Startup and replication completion never infer deletion from absent outline references. Explicit deletion and the historical index's unchanged revision are preserved.

## Legacy data and compatibility

Repository writers already save individual songs, custom documents, timers, Bible items and headings. The previous index also allowed title-only references without recoverable content; those cannot reconstruct lyrics, slides or timer settings. Local media references can reside on slide media metadata rather than the old index, and the shared adapter preserves them.

The persisted `allItems` document remains intact, including its revision, as verified with real PouchDB. New guest datasets no longer create it. Only its historical document type/schema discriminator remains in runtime tooling. Old clients that still rely on this index must be upgraded to see new document-only library changes reliably; the new client deliberately does not maintain their index.

No production church database was accessed. `node scripts/audit-item-storage.mjs <all-docs-export.json>` reports missing/deleted/index-only references from an export without changing data. It distinguishes generated service-time rows and heading metadata that can be reviewed for recovery. Missing content should be reviewed against original backups; no automatic restoration invents content or revives tombstones.

## Verified (required)

- **Broad affected-workflow run:** 47 Jest suites, 990 tests passed. This included every then-modified/new client test, plus `itemSlice.test.ts`, `SlideEditor.test.tsx`, `ItemSlides.test.tsx`, `OutlineItemSlidesScroller.test.tsx`, `outlineSlideSections.test.ts`, `DisplayWindow.corePaths.test.tsx` and `persistSongAudioAttachment.test.ts`. This was a selected affected-workflow run, not the entire client suite.
- **After removing remaining category-refresh actions:** 11 suites / 215 tests passed: `allDocsSlice`, `store`, `ControllerServicePlanView`, `Timers`, `controllerInfo`, `Item`, `useOutlineItemDocs`, `outlineSlideSections`, `ServicePlanLibraryPicker`, `itemCacheSync` and `itemCacheSync.pouch`.
- **Final navigation/import/cache regression run:** seven suites / 68 tests passed: `Item.test.tsx`, `useServicePlanningImport.test.ts`, `servicePlanningOutlineImport.test.ts`, `itemLibrarySelectors.test.ts`, `useServicePlanOutlinePush.test.tsx`, `itemCacheSync.pouch.test.ts`, `useOutlineItemDocs.test.tsx`.
- **Final metadata assertions:** `itemLibrarySelectors.test.ts`, three tests passed, plus changed-file ESLint with zero warnings. Covers persisted local image/video references and thumbnails.
- **Final real-database assertions:** `itemCacheSync.pouch.test.ts`, two tests passed after strengthening the concurrent-controller fixture to use independent PouchDB handles. Covers a real snapshot/feed installation gap, local create/edit/rename/background/deletion, offline writes, replication in both directions, unchanged historical index and one initial scan per owner.
- `node --test scripts/audit-item-storage.test.mjs`: one test passed.
- `npm.cmd run type-check --prefix client`: passed.
- `npm.cmd run build:strict --prefix client`: full client lint with zero warnings and production/PWA build passed. Vite still reports a CSS URL warning from existing security-test fixtures and large bundle warnings.
- `git diff --check`: passed.

The broad run used this test selection, followed by the focused paths listed above:

```powershell
$itemChangedTests = git diff --name-only --diff-filter=AM -- client/src | Where-Object { $_ -match '\.test\.tsx?$' } | ForEach-Object { $_ -replace '^client/', '' }
$itemNewTests = git ls-files --others --exclude-standard -- client/src | Where-Object { $_ -match '\.test\.tsx?$' } | ForEach-Object { $_ -replace '^client/', '' }
npm.cmd test --prefix client -- --runInBand --silent @itemChangedTests @itemNewTests src/store/itemSlice.test.ts src/containers/ItemEditor/__tests__/SlideEditor.test.tsx src/containers/ItemSlides/ItemSlides.test.tsx src/containers/ItemSlides/OutlineItemSlidesScroller.test.tsx src/utils/outlineSlideSections.test.ts src/components/DisplayWindow/__tests__/DisplayWindow.corePaths.test.tsx src/utils/persistSongAudioAttachment.test.ts
```

Production composition checked: `AppRoutes -> ControllerContextWrapper -> ControllerInfoProvider`, shared by Controller, Services and Resources. Browser/Electron use the same local PouchDB/cache path; paired display, human and workstation consumers retain their existing authorization/credential transport. The provider test exercises the real provider/store on a Services route while remote authentication is pending, plus same-database Redux reset and subscription retirement. Binary network services and display hardware are not simulated by those tests.

## Code review

Scope: workflow review of this storage simplification, not production-readiness certification of unrelated branch work. Findings: no outstanding blocking findings in the reviewed scope. Current request and the linked feature contract authorize document precedence, independent outlines and historical-index non-maintenance.

| Invariant | Adversarial transition and evidence | Result |
| --- | --- | --- |
| No hydration gap | Real local writes, deletion and creation occur after allDocs snapshot, before feed installation; replay starts at snapshot sequence. `itemCacheSync.pouch.test.ts` | Pass |
| Retired owner cannot publish | Hold Church A snapshot, activate B with same document ID/sequence, finish A; retire live callbacks and retry work. `itemCacheSync.test.ts` | Pass |
| Same database session resets | Full Redux reset retains database identity, replaces cache session, cancels old feed and hydrates again; old callback is ignored. `controllerInfo.test.tsx` | Pass |
| Newer content/deletions win | Pending cache-miss and direct-route reads resolve after newer cache updates/tombstones. `useOutlineItemDocs.test.tsx`, `Item.test.tsx` | Pass |
| Unsaved edits survive | Earlier local write/change/ack overlaps a newer draft; newer text persists. Remote edits still buffer and conflict decisions retain their original tests. `store.test.ts` | Pass |
| Outline ownership stays independent | Two occurrences retain individual overrides; later insertion takes metadata changed during async build. `store.test.ts`, `useServicePlanOutlinePush.test.tsx` | Pass |
| Offline and replica convergence | Independent local handles see offline writes and remote replication/deletion without rescanning. `itemCacheSync.pouch.test.ts` | Pass |
| Historical data stays safe | Historical index revision unchanged; audit reports missing/deleted entries without restoration. Real Pouch and audit-script tests | Pass |

Cross-boundary review: identity, lifetime, persistence/publication, retry, persisted compatibility, destructive cleanup and document-to-library-to-outline round trips were traced. Sibling searches covered all `allItems`, `allDocs`, refresh/upsert, media metadata and route/bootstrap callers. High-frequency display state remains outside this cache; ordinary item events update category arrays incrementally and typing does not query PouchDB.

Completion checklist: cross-boundary, sibling-pattern, legacy compatibility, identity-switch, unmount/lifetime, contract round trip, retry authority, owner retirement and production-entry-point/test-composition checks performed. Validate/use security and authorization projection changes are not applicable: no API, server permission or public projection changed. External side-effect adoption/compensation changes are not applicable: existing storage/audio mutation semantics were retained, not replaced. No new general-purpose sync or compatibility subsystem was introduced.

Final readiness: Ready for the reviewed workflow scope.

## Not verified (optional)

Full repository/server suites, live CouchDB deployment, physical multi-device/Electron presentation and a production-data audit were not run. The automated checks above cover the changed storage workflow.

## Known follow-ups

None required for this implementation. Audit actual historical data and coordinate upgrades when rolling out to churches running older clients.


## Remaining review findings ? October 26, 2026

Implementation status: COMPLETE. Scope: fix verification and affected workflow review, not branch-wide production readiness.

Before behavior: Controller startup could delete a newly created Bible/heading before its outline reference arrived. Every unrelated live document and absent tombstone incremented the cache version.

After behavior: No automatic Bible/heading scan or deletion remains. The feed filters non-item documents, and the reducer ignores unrelated payloads and tombstones without cached matches. Ignored events still advance the feed's resume sequence. Cached item tombstones still delete entries. Rare missing-document reads verify the PouchDB sequence before publishing, preserving stale-read protection without invalidating Redux for unrelated events. Loaded navigation still avoids database reads.

Behavior intentionally unchanged: PouchDB remains authoritative; one provider-owned feed maintains allDocs. Initial hydration, owner retirement, replication, explicit deletion, outline synchronization, editor conflict handling, song migrations and persisted schemas retain their existing behavior.

### Affected files

- Cleanup removal: `client/src/utils/dbUtils.ts`, `client/src/pages/Controller/useControllerPageLifecycle.ts` and their adjacent tests. The unused Bible/heading wrappers and their obsolete cleanup expectations were removed; startup regressions replace them.
- Filtering: `client/src/store/itemCacheSync.ts`, `client/src/store/allDocsSlice.ts`, `itemCacheSync.test.ts`, `itemCacheSync.pouch.test.ts`, `allDocsSlice.test.ts`. The existing item predicate is shared by the feed and reducer.
- Preserve uncached deletion safety: `client/src/hooks/useOutlineItemDocs.ts`, `client/src/pages/Controller/Item.tsx`, their adjacent tests and `client/src/test/mocks.ts`. No event bus, secondary cache, middleware or reconciliation subsystem was added.
- Contract and verification: `docs/features/item-document-storage.md`, this report. No release fragment added for these corrections to the unreleased refactor.

### Verified (required)

- Final selected Jest run: **14 suites / 286 tests passed**. Paths: `src/store/allDocsSlice.test.ts`, `src/store/itemCacheSync.test.ts`, `src/store/itemCacheSync.pouch.test.ts`, `src/utils/dbUtils.test.ts`, `src/pages/Controller/useControllerPageLifecycle.test.tsx`, `src/hooks/useOutlineItemDocs.test.tsx`, `src/pages/Controller/Item.test.tsx`, `src/components/FilteredItems/FilteredItems.test.tsx`, `src/context/controllerInfo.test.tsx`, `src/store/store.test.ts`, `src/containers/ServiceItems/ServiceItems.test.tsx`, `src/utils/outlineSlideSections.test.ts`, `src/store/itemLibrarySelectors.test.ts`, `src/store/songLibrarySelectors.test.ts`. Command: `npm.cmd test --prefix client -- --runInBand --runTestsByPath` followed by those paths.
- `npm.cmd run type-check --prefix client`: passed.
- `npm.cmd run lint:check --prefix client`: passed, zero warnings.
- `git diff --check`: passed.
- Production context: Pass. Traced `App.tsx -> ControllerContextWrapper -> ControllerInfoProvider`, its session-owned local PouchDB feed, all three Controller lifecycle callers (Controller, AuxController, OverlayController), explicit `FilteredItems` deletion, and both missing-document readers. Tests use the real lifecycle hook and Redux store, the real shared provider for session/reset coverage, and real IndexedDB-backed PouchDB for sequence checks and replication across independent handles. Browser and Electron share this storage path; no presentation renderer or authorization path changed.

### Final review

Findings: Critical / High / Medium / Low ? None outstanding within the reviewed scope. Product authorization: Authorized by the current remaining-findings request; the storage contract records the changed deletion/filtering guarantees. Open questions / assumptions: None. Pattern / learning opportunities: the existing missing-read guards required Pouch sequence verification once absent tombstones became Redux no-ops; no new enforcement or subsystem is needed.

| Invariant | Adversarial scenario and evidence | Result |
| --- | --- | --- |
| Preserve new documents | Start at progress 100 or reach 100 while the outline read is pending; persisted Bible/heading documents survive before and after references arrive. `useControllerPageLifecycle.test.tsx` runs the real hook and available database utilities. | Pass |
| Preserve explicit deletion | Real local Bible/heading removes produce 404s and update independent caches; the existing `FilteredItems` confirmation/deletion test also passes. | Pass |
| No irrelevant cache invalidation | Unrelated live events dispatch no item upsert; absent tombstones preserve state identity/version; ignored events advance retry sequence. Reducer, feed and real replication tests cover these cases. | Pass |
| No stale resurrection | Delete a missing item after its real Pouch snapshot, before publication; sequence verification re-reads instead of caching it. Also retire a prefetch while sequence verification is pending. `useOutlineItemDocs.test.tsx`; direct-route stale-read and navigation tests in `Item.test.tsx`. | Pass |
| Hydration and ownership survive | Snapshot/feed gap, failed-feed resume, same-ID church switch, Redux reset, retired callbacks and retry cancellation retain coverage in `itemCacheSync`, `itemCacheSync.pouch` and `controllerInfo`. | Pass |

Cross-boundary review, sibling/caller search, persisted compatibility, identity/lifetime tests, document-to-cache round trip, retry sequence authority, owner retirement and production/test composition comparison: performed. Validate/use security, external side-effect compensation and authorization projection changes: not applicable; these paths were not changed. Simplification check: the cleanup code is removed, the item classifier is reused, and additional production logic only filters events and preserves existing stale-read safety; most added lines are regressions.

Verification gaps: No required gaps. Optional checks not run for this follow-up: full repository suite, production build, live CouchDB deployment or physical multi-device/Electron display sessions. Final readiness: Ready for the reviewed scope. Known follow-ups: None required.
