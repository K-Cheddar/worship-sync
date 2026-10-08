# Song schema v2 conflict boundaries

Schema v2 represents a song as a root document, arrangement documents, and
slide documents. The root's ordered `arrangementIds` list and each arrangement's
ordered `slideIds` list are authoritative. Document IDs use durable song,
arrangement, and slide IDs, so renaming or reordering content does not change
document identity.

## Document and read contract

V2 database documents use `docType` as their discriminator: `song-v2-root`,
`song-v2-arrangement`, and `song-v2-slide`. A v2 root must not contain the
legacy item discriminator `type: "song"`; legacy library and maintenance scans
use that field to identify complete v1 song documents. Hydrating a v2 root
creates an application-facing song with `type: "song"` while retaining the
root `docType` as its storage-version marker.

Presence of an active v2 root enables v2 reads. Interactive saves of an
already-v2-backed song use the targeted writer and require the editor's authored
baseline. A v1 editor that remains open through root publication receives a
recoverable version-transition conflict. A root with `deletedAt` is a retained
tombstone: it suppresses a same-ID v1 predecessor and is excluded from library
reads. Normal application flows still do not create v2 roots; migration,
shadow roots, and dual writes are not enabled.

The legacy song `_rev` and v2 root `_rev` belong to different physical
documents. They must never be mixed: in particular, a v2 root revision cannot
be used when writing the legacy document with the song's original ID.

## Conflict boundaries

- **Song root:** edits to song-level metadata, links, audio metadata, background
  routing, the selected arrangement, or arrangement ordering can conflict with
  another edit to the same root. The root does not carry slide payloads.
- **Arrangement:** edits to one arrangement's lyrics, song order, monitor layout,
  name, or slide ordering can conflict with another edit to that arrangement.
- **Slide:** each slide document contains all authored state for one slide,
  including its boxes and media presentation data. Edits to different slides
  can sync independently. Two users editing the same slide can still conflict;
  that is expected.

Boxes remain together inside their slide document. There is no automatic
conflict resolution in the writer.

Songs without a v2 root continue to be read from their legacy single document,
and continue to use the v1 save path. Already-v2-backed songs use targeted
interactive saves. This document does not enable migration, v2 creation for
legacy songs, or legacy cleanup.


## Targeted write engine

> A normal edit must touch only the physical documents whose durable content changed.

Normal `createSong` remains v1. `saveSong` supports v1 and already-v2-backed
songs; v2 saves require an authored baseline. A legacy save checks for v2
activation immediately before its write and rejects stale v1 drafts with a 409.
A root is still absent from legacy `type === "song"` scans.

- `loadSongV2Snapshot(db, songId)` returns `{ root, arrangements, slides,
  hydrated }`. Only manifest-referenced children are loaded. Physical
  documents retain their own revisions and audit fields; hydration exposes
  neither arrangement nor slide revisions. Its hydration is structural and
  does not measure monitor layout.
- `planSongV2Changes(current, desired)` is a pure baseline-to-draft diff.
  It returns an optional `root: { current, next }` update and arrangement/
  slide groups containing `create`, `update: [{ current, next }]`, and `delete`.
  Equality compares authored content, including ordered manifests. It ignores
  physical revisions and top-level audit fields, treats undefined as absent,
  and ignores object key order.
- `saveSongV2(db, currentSnapshot, desiredSong)` requires the original
  snapshot. Passing a freshly loaded baseline for a stale whole-song draft
  would turn unrelated concurrent edits into apparent changes and must be
  avoided. Every update uses its own baseline document revision.
- `saveSongV2FromBaseline(db, baselineSong, desiredSong)` derives a pure
  baseline-to-desired intent plan before loading current v2 state. It validates
  only intended physical documents against their serialized baseline content,
  then rebases those writes onto current documents and their `_rev` values.
  Intended creates also check deterministic IDs for existing or orphaned docs.
- Normal `saveSong(db, desired, baseline)` routes already-v2-backed songs
  through that path. A missing authored baseline fails safely; a fresh database
  read is never substituted for the user's baseline.
- `createSongV2(db, song)` writes slides, then arrangements, then the root
  **last**. Root publication is the activation marker. Before it exists,
  exact-song reads still use v1 (or return not found for a v2-only song).
- `resumeSongV2Write(db, error)` explicitly retries the remaining steps
  after an acknowledged partial failure; it skips completed durable writes.
  It never reloads a newer revision to bypass a conflict.

### Exact write boundaries

For song `song-1`, arrangements `a/b/c`, and slides `a1/a2/a3` in `a`:

| Operation | Physical writes |
| --- | --- |
| No-op or audit-only edit | None |
| Edit a2 words | PUT `song-v2:slide:song-1:a:a2` |
| Edit a1 and a3 | PUT each of those two slide documents |
| Rename, metadata, links, audio, background, routing, title policy, selected arrangement | PUT `song-v2:root:song-1` only |
| Edit b name, lyrics, song order, monitor layout | PUT `song-v2:arrangement:song-1:b` only |
| Reorder a/b/c | PUT root only |
| Reorder a1/a2/a3 | PUT arrangement a only |
| Add slide new to a | PUT `song-v2:slide:song-1:a:new`, then PUT arrangement a |
| Add arrangement new with n1/n2 | PUT both new slides, PUT new arrangement, then PUT root |
| Remove a2 | PUT arrangement a without a2, then REMOVE a2 |
| Remove b | PUT root without b, then REMOVE b and its slides |
| Create v2 song | PUT all slides, then all arrangements, then root last |

Stable IDs do not change on rename/reorder. Existing slides, arrangements,
and roots use their individual `_rev` values, never a parent/hydrated revision.
Normal saves issue individual PUTs for changed documents; there is no
whole-song `bulkDocs` operation.

### Manifest authority and failure ordering

Adds publish children before references. If a child fails, its parent
manifest is not written. A successfully written child whose later manifest
write fails is an orphan; the engine leaves it in place. Hydration follows
manifest references and ignores it.

Removals drop references before cleanup. The engine completes all required
PUTs before any cleanup REMOVE. A failed manifest write prevents cleanup.
For arrangement removal, root publication precedes arrangement cleanup,
which precedes slide cleanup. Cleanup failures are returned separately in
`cleanupErrors`; they do not undo or fail the logical removal. Even a cleanup
409 is reported there, and never retried with a reloaded revision.

### Conflicts, partial commits, and retries

Two drafts based on the same snapshot that edit different slides write
different Couch documents. Neither competes for the other's revision.
Metadata versus slide edits and arrangement A versus B edits likewise have
independent conflict boundaries. Two drafts editing the same slide use the
same revision and the second receives the normal Couch 409.

Required PUT failures throw `SongV2WriteError`, with the original `cause`,
`status` (including 409), failed `documentId`, acknowledged `progress`, and
`remainingDocumentIds`. There is no automatic merge or overwrite. The operation
does not report success if any required write fails.

### Idempotent interactive retries

Interactive saves classify each intended root, arrangement, and slide update by
authored content, ignoring `_rev` and audit timestamps:

```text
current == baseline -> pending local intent; write desired
current == desired  -> already applied; preserve current revision and skip
otherwise           -> concurrent edit
```

This three-way rule lets a retry converge after partial writes, lost write
acknowledgements, or an explicit retry without weakening same-document conflict
detection. Already-applied documents remain the physical documents loaded from
PouchDB in the returned snapshot. A deleted child counts as already removed only
when its authoritative parent manifest no longer references it; a missing child
still referenced by its parent is an incomplete-state conflict.

When a required child was created but its later manifest publication failed, a
retry may find the child at its deterministic ID. It resumes publication only
when the child's authored content exactly matches the intended create, ignoring
physical revision and audit fields. Different content at that ID remains an
`already-exists` conflict; the writer does not adopt or merge unknown content.

The successful result contains `song`, `snapshot`, `written`, `created`,
`deleted` (physical IDs), and `cleanupErrors`. The returned snapshot carries
the acknowledged revisions for subsequent editing. It is an operation-local
snapshot, not a fresh read of concurrent changes to untouched documents.
Reload before beginning a new draft when a fresh view is required.

Couch/Pouch provides **no multi-document transaction** here. An edit to three
existing slides may commit the first and fail on the second, leaving a partial
edit visible. Manifest ordering prevents intentionally publishing missing
children, but does not provide whole-song atomicity, rollback, or a consistent
cross-document read transaction. Stable independent slide identities are
preserved; no generations or versioned slide identities are introduced.

The low-level explicit resume uses captured payloads and original revisions for
pending steps, skipping acknowledged writes. Baseline-aware interactive retries
instead reload and classify current authored content as documented above. Retry
state is not a durable recovery journal.

### Audit and optional-field semantics

Each changed physical document preserves its own `createdAt` and
`createdBy`, updates `updatedAt`, and uses `applyPouchAudit` for the current
actor. New documents receive their own creation timestamp/actor. Unchanged
documents retain their revisions and timestamps without any write.

Desired content is serialized structurally and replaces the authored payload
of a changed document. It is not merged onto the old document. Removed optional
root, arrangement, and slide fields stay absent. Persisted monitor layout is
retained when supplied, or structurally recovered from legacy monitor clones;
the writer never calculates a new layout with DOM measurement.

### Deletion

Deleting a v2 song writes a root tombstone with an empty arrangement manifest
first. The tombstone is the logical deletion point and remains in place so the
retained v1 copy cannot become authoritative again. Arrangement and slide
documents, followed by the legacy predecessor, are cleanup work; failures are
reported and can be retried by calling `deleteSong` again. Ordinary save calls
log child cleanup failures and accept an `onCleanupErrors` diagnostic callback.
`reconcileSongV2Orphans` retries only named failed child removals after reading
the current manifests and confirming those IDs remain unreferenced.

## Library discovery and lazy slides

A published `song-v2:root:<songId>` is the authoritative activation marker for reads.
`discoverSongLibrary()` resolves only the root's ordered `arrangementIds`; orphan
arrangements and slides never become library items. `buildSongV2LibraryProjection()`
returns a logical `DBItem` (`_id = songId`, `type = song`, `docType = song-v2-root`)
with root metadata and arrangements containing IDs, names, `formattedLyrics`,
`songOrder`, optional `monitorLayout`, and `slides: []`. It performs no DOM measurement
and copies no child revisions. `loadSongV2LibraryProjection()` independently resolves
arrangements with bounded `allDocs({ keys, include_docs: true })` reads.

`updateAllDocs()` first lists IDs and excludes v2 slide IDs before reading document
bodies. Searching titles, artists, and formatted lyrics across every arrangement
requires no slide documents. The global song library remains a read model, containing
canonical v1 documents and lightweight v2 projections, even after exact-load upserts.

V2 wins over a coexisting legacy document and over stale `allItems` identifying
metadata. Legacy-only songs preserve the existing index precedence. `allItems` remains
a lightweight initialization index; missing rows can be repaired from valid projections.
Missing or invalid referenced v2 arrangements produce structured `incomplete-v2`
diagnostics and exclude the song, including its stale index row. They never fall back
to stale v1 data. A subsequent replication refresh rebuilds the projection and recovers
when the manifest children arrive. Remote index deletion protections remain in place.

Controller/editor opening and service-plan controller synchronization use exact
`loadSong()` / `loadItemWithSongHydration()` loads. The library lyrics editor hydrates
before mounting its draft panel, with pending/error UI and stale-result cancellation.
Outline slide previews keep exact v2 content in their local cache, rather than Redux
library state. Active-controller refresh also exact-loads before applying or buffering
remote slide content, including slide-only changes. Resource, audio, matching, and
lyrics viewing paths use projection metadata and formatted lyrics directly.

Normal `createSong` remains v1. Explicit v2 deletion retains a root tombstone
and cleans its children after the logical removal. Audio replacement writes the
new root pointer before deleting the previous object. V2 removal clears the
pointer before external cleanup so a root conflict preserves the previous
object. This phase does not automatically migrate songs, publish roots, or
dual-write.

## Interactive editing and conflict isolation

The active controller's `baseItem` is the authored editing baseline. A
successful save advances it to the acknowledged hydrated song, and accepting a
buffered remote update makes that accepted song the next baseline. Child
physical `_rev` values stay in the freshly loaded `SongV2Snapshot`, never in the
hydrated editor song. The library lyrics editor retains the exact hydrated song
used to open its draft and passes it back as `baselineSong` when saving.

The baseline and desired editor song define intent. Only after that intent is
known does the repository load the current authoritative v2 documents. It
validates each intended root, arrangement, or slide against the corresponding
serialized baseline document, then rebases the intended payload onto current
revisions and uses the existing ordered executor. Changes to the same document
conflict; changes to different physical documents preserve each other. A slide
being deleted is checked against its baseline too, so a concurrent slide edit
conflicts before logical deletion.

This prevents stale whole-song overwrites. If the editor changed Slide A while
the database independently changed Slide B, only Slide A is in the intent plan.
The current Slide B is preserved and its stale editor value is never treated as
authored intent. The fresh snapshot supplies current revisions and untouched
state, but it is never used to infer what the editor intended to change.

After a v2 save, library Redux receives a lightweight projection with empty
slide arrays. Cross-window `broadcastItemUpdate` also sends the projection;
receivers use it with their existing refresh path instead of receiving a
hydrated slide payload as a whole-song document.

### Consumer audit

| Consumer | Required data / exact-load boundary |
| --- | --- |
| FilteredItems, song selectors, index repair | Projection metadata and formatted lyrics; incomplete IDs suppress stale index rows. |
| Service Plan matching, reference resolution, Service Planning import | Logical IDs, names, metadata, and formatted lyrics; no authored slide dependency. |
| ViewSongSectionsDrawer, ServicePlanSongDetailsPanel | Viewing uses formatted lyrics; shared LyricsEditor exact-loads before initializing a v2 draft and returns that exact baseline on save. Metadata and audio pointer edits use baseline-aware targeted writes. |
| Resources and song-audio viewing | Root metadata/audio pointers; v2 attachment removal clears the pointer before external object cleanup. |
| AddSongSectionsDrawer | Imports formatted sections only, without reading slide boxes. |
| Controller opening, outline attachment, Service Plan outline push | Attachments remain lightweight ServiceItems; Controller Item and createNewItemInDb already use loadItemWithSongHydration. |
| Active controller replication refresh | Exact-loads before applying/buffering v2 content; keeps dirty drafts and discards obsolete owner/database/projection loads. |
| Outline counts/thumbnails/slide previews | useOutlineItemDocs exact-loads referenced v2 songs into a local cache; library upserts strip authored v2 slides. |

### Phase verification (2026-10-05)

Latest upstream merged: `62106c26` into isolated `in-progress-3` (merge `3603928c`),
with no conflicts. The earlier requested merge included `ddcecb84`. No reverse merge,
migration, real-song fixtures, normal v2 write activation, or legacy deletion occurred.

Focused Jest selection: 32 suites, 570 tests passed. The exact selected files were:

```text
src/store/store.test.ts
src/store/store.v2LibraryRefresh.test.ts
src/components/SongSections/ViewSongSectionsDrawer.test.tsx
src/pages/Services/ServicePlanSongDetailsPanel.test.tsx
src/containers/ItemEditor/__tests__/LyricsEditor.test.tsx
src/containers/ItemEditor/__tests__/LyricsEditor.v2Hydration.test.tsx
src/containers/ItemEditor/__tests__/AddSongSectionsDrawer.test.tsx
src/utils/songSearchUtils.test.ts
src/utils/songPersistence.test.ts
src/utils/songV2Writer.test.ts
src/utils/songV2Writer.indexedDb.test.ts
src/utils/songLibraryDiscovery.test.ts
src/utils/songLibrary.test.ts
src/utils/dbUtils.test.ts
src/store/songLibrarySelectors.test.ts
src/store/songLibraryIndexRepair.test.ts
src/store/allDocsSlice.test.ts
src/hooks/useOutlineItemDocs.test.tsx
src/utils/outlineSlideSections.test.ts
src/pages/Services/useServicePlanOutlinePush.test.tsx
src/pages/Services/servicePlanOutlineBridge.test.ts
src/pages/Services/ServicePlanLibraryPicker.test.tsx
src/pages/Services/SongReferencePicker.test.tsx
src/pages/Resources.test.tsx
src/integrations/servicePlanning/buildServicePlanningPreview.test.ts
src/store/itemLibrarySelectors.test.ts
src/containers/ServiceItems/ServiceItems.test.tsx
src/pages/Controller/Item.test.tsx
src/components/FilteredItems/FilteredItems.test.tsx
src/components/DisplayWindow/__tests__/DisplayWindow.corePaths.test.tsx
src/pages/Services/ServicePlanEditor.test.tsx
src/pages/Services/ServicePlanCustomDocumentPicker.test.tsx
```

Command: `npm.cmd test --prefix client -- --runInBand <selected files above>`.
Final follow-up runs: `useOutlineItemDocs.test.tsx` (4 tests passed), and
`songLibraryDiscovery.test.ts`, `songPersistence.test.ts`, `songV2Writer.test.ts`,
`songV2Writer.indexedDb.test.ts` (75 tests passed). The latter includes malformed
referenced lyrics rejection and all established writer invariants.

`npm.cmd run lint:check --prefix client`, `npm.cmd run build:strict --prefix client`,
and `git diff --check` passed. The full repository suite was not run.
`npm.cmd run type-check --prefix client` retains three established diagnostics:
ServicePlanEditor.test.tsx's unknown mock database, itemUtil.test.ts's ItemState
revision assertion, and deleteSong's optional DBItem revision versus Pouch RemoveDocument.
The phase adds no new TypeScript diagnostics. Three legacy mock failures were also
reproduced with the merged-baseline persistence implementation; their mocks now return
404 for absent v2 roots and reuse deferred reads, preserving every behavior assertion.

Final review found no unresolved phase issues. Normal mutation/delete activation,
coexistence deletion semantics, migration/recovery validation, and real-device cutover
acceptance remain separate prerequisites before migration/cutover. Live Electron/OBS
manual acceptance and the exhaustive CI suite were not run for this read-model phase.
