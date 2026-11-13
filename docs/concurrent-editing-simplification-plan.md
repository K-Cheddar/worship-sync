# Concurrent editing simplification

## Goal and confirmed behavior

Let two Controllers make compatible edits to one Song V2 arrangement or one service outline, save and replicate in either order, converge without a review prompt, and continue editing. Retain both intentions and request a focused choice only when authored content cannot be safely combined. This behavior and the focused conflict UI are authorized by the November 12, 2026 request.

## Findings before implementation

- Song V2 stores a root, arrangement, and slide as separate PouchDB documents. `loadSongV2Snapshot` reported every `_conflicts` leaf as active without comparing authored bodies, so store refresh paths paused the editor. Automatic reconciliation handled arrangement lyric branches but treated slide leaves as unresolved. The writer already had a canonical authored-content comparison that ignores revision and audit metadata.
- Outline drag dispatched a complete array. `reconcileOutlineItems` could rebase runtime move intentions during a later save, but successful acknowledgments cleared those intentions before a replication refresh could see both saved branches. A new Controller may also have the leaf revisions without the common ancestor body.
- PouchDB/CouchDB expose revision trees and require application code to choose conflict policy. The selected approach keeps the current per-document CAS and replication model; it does not add a collaboration service or CRDT. Independent content uses three-way merge against a shared baseline. Outline order uses stable occurrence identities, explicit move anchors, and combined precedence constraints; a cycle or ambiguous legacy reorder remains a focused conflict.

## Before behavior

Different physical revisions can pause Song V2 editing even when their authored content is equivalent or their edits can be merged. Different outline sequences can pause saving even when operators moved separate rows. The outline review is mounted inline in the sidebar.

## After behavior

Classify physical Song V2 leaves using the writer's canonical authored-content rules. Equivalent leaves do not block editing; safe disjoint arrangement text edits still use the revision-checked merge path, while ambiguous slide or structural conflicts remain for explicit review. A committed merge remains usable after restart when cleanup fails: a fresh Controller re-derives the merged arrangement from the saved winner and common revision ancestry, avoids rewriting already-merged authored content, and retries cleanup under current revision and authorization guards. Preserve durable autosave recovery. Outline saves rebase recorded row-move destinations over the latest winner, retain independent additions/deletions and field edits, and focus only incompatible destinations or ambiguous legacy reorders. A verified order-only branch may carry a compact revision-local marker with its parent and baseline row order. An authorized Controller auto-merges only two direct sibling leaves with compatible marked moves, identical row bodies and unchanged non-order fields; other historical or ambiguous branches remain untouched. Show review in a modal opened from a compact sidebar notice.

## Behavior intentionally unchanged

PouchDB/CouchDB architecture, Song V2 document schema, access checks, owner/session capture, revision guards, durable Song V2 crash recovery, presentation behavior, and winner-only operational handling of historical outline leaves. The outline's optional revision-local move marker does not add a registry or alter ordinary outline documents after their next save.

## Affected paths and verification

Song V2 serialization/writer/snapshot/revision reconciliation, Redux refresh/autosave/conflict state, outline slice/persistence/drag interaction, and sidebar review. IndexedDB-backed replica tests cover saves before replication, bidirectional replication, physical revision leaves, continued editing, restart cleanup failure, and authorized cleanup retry. Controller lifecycle tests cover saved outline moves after acknowledgment, a third Controller after the original Controllers close, repeated notifications, read-only access, continued editing, and session change during pending reconciliation.

The November 12 concurrent-editing follow-up passed the focused PouchDB/outline/Redux/Controller/Song V2/UI run (13 suites, 259 tests) and `src/store/store.test.ts` (210 tests). `npm.cmd run type-check`, `npm.cmd run lint:check`, and `npm.cmd run build` passed. The build still prints the existing CSS test-fixture, import chunking, and large-chunk warnings. Controller/store tests use two local PouchDB replicas and exercise both Controller refresh stores; full interactive verification with two logged-in Controller windows remains a manual follow-up. No deployment or merge was performed.
