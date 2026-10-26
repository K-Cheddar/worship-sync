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

Bible/heading cleanup now scans actual item documents and outline references. It preserves documents when the outline registry/references cannot be verified and uses snapshot revisions for deletions. Automatic startup cleanup waits until initial replication reaches completion. The historical index is never updated by this cleanup.

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
