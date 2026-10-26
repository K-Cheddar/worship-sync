# Feature Contract: Manual item-library search

**Contract status:** Confirmed product intent

**Approval source:** User request to unify and improve item search and accepted implementation plan, October 24-25, 2026. Follow-up decisions retain partial hits and title-based import suggestions.

**Last reviewed:** 2026-10-25

## Purpose and operator workflow

Let operators find library items by title, remembered lyrics, artist, or custom slide text, including imperfect spelling and word order. Operators retain explicit control over viewing, selecting, adding, attaching, and creating items.

## Expected behavior

- All manual library searches share matching and relevance rules. Category filters change eligible types, not their scores.
- Exact titles rank first. Complete/prefix titles have strong relevance, but an exact multiword lyric phrase can outrank a weak title fragment.
- Distinct query-term coverage, concentrated passages, and word order improve relevance. Repeated words, sections, and arrangements do not add occurrence-based score.
- Common words carry less weight, but remain useful in phrases. Keep useful partial hits below stronger results; exclude common-word-only results when the query has meaningful words.
- Conservative typo matching supports missing, extra, substituted, and adjacent transposed characters in titles and lyrics. Short/common words are not fuzzy matched; comparable exact evidence beats fuzzy evidence.
- Search every arrangement and combine keyword coverage across lyric sections. Do not construct phrase evidence across separate passages or arrangements.
- Use the best matching passage for the excerpt. Highlight with the same normalization and token rules as retrieval, using the query that produced the visible results. Preserve lyric-preview expansion controls.
- Resolve documents by stable ID and type. Duplicate custom-item names never transfer slide content between items.
- Indexed titles remain searchable before document hydration; unavailable documents contribute no artist or lyric evidence.
- Empty searches retain alphabetical ordering. The compact song-reference picker keeps its hidden empty-query list and eight-result limit.

## Behavioral boundaries

Search remains local and offline compatible. Typing does not read the database, call a server, persist a search index, or change presentation or synchronization state. Preserve debounce, virtualization/incremental loading, filters, external search, create actions, permissions, selection, and attach behavior.

Automatic identification and imported-plan Closest matches remain on conservative title similarity, confidence, and ambiguity rules. Manual lyric/fuzzy evidence must never authorize an automatic link. The popover's Search library action uses the improved manual search. See [service-plan import](service-plan-import.md) and [controller content viewing](controller-content-viewing.md).

## Product decisions

- **Partial queries:** Retain useful partial hits, ranked below better coverage. Rejecting every incomplete query would hide songs when remembered wording is imperfect. Approved in the planning response, October 24, 2026.
- **Import suggestions:** Preserve title-based Closest matches; use improved retrieval in the explicit Search library action. This preserves the identity-resolution workflow. Approved in the planning response, October 24, 2026.
- **Stable identity and hydration:** Search indexed titles without inventing document content; use saved IDs for custom slides. Explicitly authorized by this task and the controller-content-viewing contract.

## Important scenarios and regression evidence

| Scenario | Expected outcome | Tests |
| --- | --- | --- |
| how sweet the sound | Amazing Grace lyric phrase beats weak sound title | songSearchUtils; FilteredItems; ServicePlanLibraryPicker; SongReferencePicker; AddSongSectionsDrawer |
| amzing grace, how graet thou art, sheperd, halleluja, holy spirt, greta are you lord | Intended title/lyric hits retrieved with conservative token highlighting | songSearchUtils; HighlightWords |
| Different sections/arrangements | Combined coverage; best real passage; no invented cross-section phrase | songSearchUtils |
| Duplicate custom names / indexed-only title | Correct ID's content / title-only result without lyric excerpt | songSearchUtils; FilteredItems; SongReferencePicker |
| Rapid typing / library replacement / drawer close | Results and highlights share their query; latest document content; existing reset behavior | FilteredItems; SongReferencePicker; AddSongSectionsDrawer |
| Manual lyric hit during import | Manual result does not become automatic identity evidence | findServicePlanningSongMatch |

## Implementation references and audit observations

- Shared implementation: `client/src/utils/songSearchUtils.ts`. Song adapters preserve original selected documents; generic item results carry transient score/excerpt fields. No persisted/API types change.
- Controller and library routes use ItemLibrary -> FilteredItems. Services Add Song and Custom Document modals also use FilteredItems. Add Song Sections uses useSongSearchPagedList. SongReferencePicker uses the canonical merged song selector; it currently has no production callers, but its exported behavior and tests remain supported.
- External provider retrieval, automatic title matching, duplicate-song detection, and unrelated Bible/media/resource/member/plan filters are intentionally excluded.
- Previously, compareItemSearchRanks forced every positive title match above every lyrics-only match. General string matching favored words earlier in a lyric section, did not retrieve fuzzy words, and highlighting independently used Levenshtein rules. FilteredItems duplicated content scoring and used custom names in category mode; indexed songs without documents had zero score. SongReferencePicker used title substring filtering.

## Technical design notes (not product guarantees)

Scores are bounded evidence, not occurrence counts:

- Token quality: exact 1, final-term prefix 0.85, embedded final-term partial 0.4, fuzzy 0.65. Common query terms weigh 0.2; others weigh 1.
- Overall coverage uses the best evidence per distinct query term across fields/passages. It contributes up to 100 points.
- Field bonuses: up to 60 for contiguous ordered phrase coverage, 20 for concentration, and 10 for ordered proximity. Title coverage contributes up to 25, title prefix and complete reordered title add 30 each. Artist coverage contributes up to 12.
- Use the strongest field bonus, not a sum over lyric occurrences. A normalized exact title adds 1000 and always wins. Ties use name, artist, type, then stable ID.
- One edit is allowed for query words of lengths 4-7; two from length 8, with a maximum 25% length ratio. Candidate words must also have at least four characters. Adjacent transposition costs one. Fuzzy-only results require quality-weighted coverage of at least half the meaningful terms.
- Immutable-document WeakMaps cache normalized passages and vocabulary. Snapshot WeakMaps cache union vocabulary. Per-query comparison/field caches are discarded afterward. Matching considers candidate vocabulary once per query, prunes by length, and bounds edit-distance work. Per-document token interning reduces retained strings.
- Existing snapshot memo boundaries prepare content before typing. Updates invalidate only changed documents; retired document/snapshot keys can be collected. A large initial preparation is synchronous; see the benchmark results and limits in the implementation handoff.

Benchmark: from `client/`, run `node --expose-gc --import tsx scripts/benchmark-item-search.ts`. The deterministic fixtures include 1,000/5,000 songs, three arrangements, six lyric sections per arrangement, unique section text, and common vocabulary. It reports cold preparation/search, warm median/p95, vocabulary size, result count, and approximate retained heap. Timing is informational, not a CI assertion.
