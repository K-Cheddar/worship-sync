# Concurrent editing simplification

## Goal and confirmed behavior

Let two Controllers make compatible edits to one Song V2 arrangement or one service outline, save and replicate in either order, converge without a review prompt, and continue editing. Retain both intentions and request a focused choice only when authored content cannot be safely combined. This behavior and the focused conflict UI are authorized by the November 12, 2026 request.

## Findings before implementation

- Song V2 stores a root, arrangement, and slide as separate PouchDB documents. `loadSongV2Snapshot` reported every `_conflicts` leaf as active without comparing authored bodies, so store refresh paths paused the editor. Automatic reconciliation handled arrangement lyric branches but treated slide leaves as unresolved. The writer already had a canonical authored-content comparison that ignores revision and audit metadata.
- Outline drag dispatched a complete array. `reconcileOutlineItems` treated divergent order changes as a whole-order conflict, although row fields already merged by stable occurrence ID. Persistence uses a winner read and revision-checked compare-and-swap, so move reconciliation can stay outside stored documents.
- PouchDB/CouchDB expose revision trees and require application code to choose conflict policy. The selected approach keeps the current per-document CAS and replication model; it does not add a collaboration service or CRDT. Independent content uses three-way merge against a shared baseline. Outline order uses stable occurrence identities, explicit move anchors, and combined precedence constraints; a cycle or ambiguous legacy reorder remains a focused conflict.

## Before behavior

Different physical revisions can pause Song V2 editing even when their authored content is equivalent or their edits can be merged. Different outline sequences can pause saving even when operators moved separate rows. The outline review is mounted inline in the sidebar.

## After behavior

Classify physical Song V2 leaves using the writer's canonical authored-content rules. Equivalent leaves do not block editing; safe disjoint arrangement text edits still use the revision-checked merge path, while ambiguous slide or structural conflicts remain for explicit review. A committed merge remains usable if retirement of its reviewed leaves fails, provided the winner and leaf set have not changed. Preserve durable autosave recovery. Outline saves rebase recorded row-move destinations over the latest winner, retain independent additions/deletions and field edits, and focus only incompatible destinations or ambiguous legacy reorders. Show review in a modal opened from a compact sidebar notice.

## Behavior intentionally unchanged

PouchDB/CouchDB architecture, Song V2 document schema, outline document schema, access checks, owner/session capture, revision guards, durable Song V2 crash recovery, presentation behavior, and winner-only operational handling of historical outline leaves.

## Affected paths and verification

Song V2 serialization/writer/snapshot/revision reconciliation, Redux refresh/autosave/conflict state, outline slice/persistence/drag interaction, and sidebar review. IndexedDB-backed replica tests cover saves before replication, bidirectional replication, physical revision leaves, continued editing, and cleanup failure. Outline tests also cover move-versus-delete choices, independent deletion and movement, repeated moves, and continued editing after convergence.

The final focused Song/outline/persistence/Redux/Controller run passed 10 suites and 141 tests. `src/store/store.test.ts` passed 209 tests. Client lint, TypeScript checking, and the production build passed. The build still prints existing CSS fixture, import chunking, and large chunk warnings. Full interactive verification with two logged-in Controller windows remains a manual follow-up; no deployment or merge was performed.
