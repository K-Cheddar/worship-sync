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

Presence of a v2 root currently enables v2 reads. Normal v2 mutations remain
intentionally disabled: normal save and delete operations on a v2-backed song
fail with SongV2WriteNotEnabledError. The isolated writer below is available
only to focused tests and future migration tooling. No normal application flow
creates v2 documents; migration, shadow roots, and dual writes are not enabled.

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
conflict resolution in the isolated writer.

Songs without a v2 root continue to be read from their legacy single document,
and all normal song writes remain v1. This document describes the v2 contract;
it does not enable migration, production v2 writes, or legacy cleanup.


## Isolated write engine

> A normal edit must touch only the physical documents whose durable content changed.

The engine is deliberately dormant. Normal `createSong`, `saveSong`, and
`deleteSong` retain v1 behavior and the existing v2 guards. No Redux autosave,
song-details, linking, audio, library discovery, or migration workflow calls
the new APIs. A root is still absent from legacy `type === "song"` scans.

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
`remainingDocumentIds`. There is no automatic merge, reload, or overwrite.
The operation does not report success if any required write fails.

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

An explicit resume uses captured payloads and original revisions for pending
steps, skipping acknowledged writes. A repeated resume of an already completed
error can conflict; callers should retain the latest result/error. A lost
acknowledgement has an unknown outcome and may conflict on retry. The engine
does not infer success or silently adopt an existing orphan. New preparation
from an old snapshot may also conflict with an orphan at a stable ID; tooling
must reconcile that situation explicitly. Retry state is in-memory, not a
durable recovery journal.

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

### Deletion and the remaining cutover boundary

Physical whole-song v2 deletion is deliberately deferred. Normal delete still
rejects v2-backed songs. Migration must first define how deletion behaves when
v1 and v2 coexist, then implement root-first deactivation and child cleanup.
This phase does not migrate, dual-write, delete legacy songs, enable v2 library
discovery, or activate production v2 writes.
