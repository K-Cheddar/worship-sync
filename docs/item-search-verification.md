# Item search verification and review

Date: 2026-10-25. Branch: `in-progress`. Scope: implementation fix verification and affected workflow review, not a branch-wide production-readiness review.

## Findings

Critical / High / Medium: None remaining in the reviewed search paths.

Low / residual performance concern: Normalizing the synthetic 5,000-song library and performing its first search took 524.3 ms and retained approximately 71.3 MiB beyond the source documents. Preparation now happens at existing document-snapshot memo boundaries, so typing reuses it. Warm lyric-phrase p95 was 117.5 ms, above the 100 ms planning target, although its median was 89.3 ms. This was investigated by replacing repeated phrase scans, sharing vocabulary comparisons, avoiding repeated collator creation, adding bounded fast paths, and interning document tokens. Do not generalize these synthetic timings to every device or lyric corpus. Further worker/index infrastructure is outside this focused implementation.

## Product authorization status

Authorized by the current task, accepted plan, and [manual item-library search contract](features/item-library-search.md). Partial results remain available; import Closest matches remains title-based, as explicitly selected during planning. Stable-ID content resolution also follows the controller-content-viewing contract.

No API, persisted document, Firebase, Electron/IPC, server, or automatic identification behavior was changed. Comments in the automatic identification helpers now accurately describe their separate legacy title-ranking pipeline.

## Open questions / assumptions

None requiring a product decision. Document/snapshot caches rely on immutable Redux documents and arrays. Cache regression coverage replaces a document while retaining its ID and verifies that old lyrics disappear. Cached data is derived and scoped by object identity, not a global ID namespace.

## Verified checks

- `npm.cmd run type-check --prefix client`: passed.
- `npm.cmd run lint:check --prefix client`: passed with zero warnings.
- `git diff --check`: passed.
- `npm.cmd test --prefix client -- --runInBand --runTestsByPath` with these exact paths: **15 suites, 207 tests passed**.

```text
src/utils/songSearchUtils.test.ts
src/components/FilteredItems/HighlightWords.test.tsx
src/components/FilteredItems/FilteredItems.test.tsx
src/pages/Services/SongReferencePicker.test.tsx
src/pages/Services/ServicePlanLibraryPicker.test.tsx
src/containers/ItemEditor/__tests__/AddSongSectionsDrawer.test.tsx
src/integrations/servicePlanning/findServicePlanningSongMatch.test.ts
src/integrations/servicePlanning/songTitleSimilarity.test.ts
src/utils/generalUtils.test.ts
src/containers/ItemLibrary/ItemLibrary.test.tsx
src/pages/Services/ServicePlanCustomDocumentPicker.test.tsx
src/pages/Services/ServicePlanSongSuggestionPopover.test.tsx
src/components/SongSections/ViewSongSectionsDrawer.test.tsx
src/components/FilteredItems/filteredItemsVirtualRowHeight.test.ts
src/containers/ItemEditor/__tests__/LyricsEditor.test.tsx
```

The pre-change baseline comprised songSearchUtils, findServicePlanningSongMatch, and songTitleSimilarity: 3 suites / 65 tests passed. Existing behavioral expectations were retained; the old blanket-title-priority test was renamed to describe the comparable single-word case it actually tests, with its assertion unchanged. The reference-picker test now waits for the explicitly added debounce.

### Production context: Pass

Traced App -> ControllerContextWrapper / AuthGate -> Controller -> library routes, ItemLibrary's merged Redux selectors, Services editor document/index initialization, the attach modal and custom-document picker, and LyricsEditorPanel -> AddSongSectionsDrawer. Search reads existing hydrated documents/indexes; it neither acquires new permissions nor changes the loading lifecycle. The generic song-reference picker currently has no production callers.

Tests render representative Redux/router/controller/global contexts and actual shared picker/list components. PouchDB, media, and external APIs remain mocked; those services' behavior is outside the changed local-search boundary. Modal/drawer tests exercise deferred details, attach/create actions, and section selection/import. Existing view-only behavior, category initialization, external lyrics creation, virtual row heights, and close/reset behavior passed.

| Invariant | Concrete transition and inspected path | Evidence |
| --- | --- | --- |
| Current result query owns highlighting | Type a new query before 250 ms expires; FilteredItems renders filteredSearchValue, drawer renders debouncedSearchValue | FilteredItems and AddSongSectionsDrawer regressions passed |
| No stale document/identity content | Switch library while debounce is pending; replace same-ID document; close/unmount before pending debounce | SongReferencePicker and normalized-cache regressions passed |
| Custom identity is stable | Two same-name custom documents with different slide text; query the second document in category mode | Shared utility and FilteredItems regressions passed |
| Missing hydration never invents content | Search indexed title with no document, then hydrate lyrics | Utility and picker regressions passed |
| Manual search cannot authorize automatic linking | Lyric phrase retrieves Amazing Grace manually; title-only automatic matcher and suggestions reject it | findServicePlanningSongMatch regression passed |
| Explicit actions retain their payloads | Open Add Song, search with typo, attach selected reference; select/import original arrangement sections | ServicePlanLibraryPicker and LyricsEditor/AddSongSectionsDrawer tests passed |

### Representative performance

Command from `client/`: `node --expose-gc --import tsx scripts/benchmark-item-search.ts` (Node 22.23.1). Twelve samples per warmed query. Synthetic songs have three arrangements and six sections per arrangement; text varies per song/section. Shared vocabulary comparisons are cached per query, and a getter-based regression verifies normalization is not repeated on subsequent queries.

| Library | Vocabulary | Cold prepare + first search | Approx. cached heap | Warm median range | Warm p95 range |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 songs | 1,108 | 133.4 ms | 12.0 MiB | 3.6-11.6 ms | 4.5-43.0 ms |
| 5,000 songs | 5,108 | 524.3 ms | 71.3 MiB | 23.4-89.5 ms | 24.2-117.5 ms |

| Query, 5,000 songs | Median | p95 |
| --- | ---: | ---: |
| Amazing Grace 120 | 89.5 ms | 93.9 ms |
| how sweet the sound | 89.3 ms | 117.5 ms |
| sound sweet | 67.1 ms | 71.8 ms |
| sheperd | 33.7 ms | 57.3 ms |
| holy spirt | 42.7 ms | 45.8 ms |
| zzzzunmatched | 23.4 ms | 24.2 ms |

Vocabulary size bounds distinct token comparisons per query; repeated lyric occurrences reuse those comparisons. These are synthetic measurements and approximate heap deltas after explicit GC, not hard memory limits or timing assertions in CI. No new worker, dependency, server, or persistent search index was introduced.

## Verification gaps

Required: None remaining for the scoped implementation/workflow review.

Optional: Full repository suite, real browser/Electron visual exercise, and profiling on low-powered hardware were not run. Synchronous initial normalization and occasional warm p95 above 100 ms remain documented limitations. Search is lexical, so synonyms, substantial wording differences, and unavailable lyric documents remain limitations.

## Pattern / learning opportunities

Query identity must travel with derived search results, including excerpts and highlights. This is enforced in focused regressions; no new repository-wide policy or abstraction is needed.

## Final readiness

Ready for the stated implementation/workflow review scope, with the measured performance limitations above. This is not an exhaustive release-readiness claim.

- Cross-boundary and sibling-pattern review: Yes; both library and drawer had the same raw-query highlighting defect and were corrected.
- Legacy/persisted compatibility and contract round trip: Yes; unchanged document/attachment shapes, original DBItem selection preserved, automatic matching helpers unchanged in behavior.
- Identity-switch and unmount/lifetime coverage: Yes; query cancellation and immutable document replacement verified.
- Production context and test composition compared: Yes; read-only Redux search has no new provider, permission, or I/O requirements.
- Validate/use security boundary and authorization/data projection: Not applicable; no new access, serialization, or external resource use.
- Retry-state authority, owner-retirement handoff, and external side-effect compensation: Not applicable; search introduces no durable operation or external side effect.
