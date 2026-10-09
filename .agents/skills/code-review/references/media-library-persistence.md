# Media Library persistence matrix

Consult when a change affects Media list/folder state, local saves, deletion, provider cleanup, or switching the active church/controller. Select realistic rows from the changed path; inspect both persisted correctness and the operator's intended folder structure.

| Adversarial sequence | Inspect in code | Evidence to seek |
| --- | --- | --- |
| Save A starts; edits B then C occur; acknowledgments or writes settle out of order | Save queue/writer, sequence or revision checks, Redux updates, and save-baseline advancement | Deterministic A→B→C test; newest edit remains visible and persisted, and an older acknowledgment cannot mark C saved. |
| A remote change arrives while a local write is pending | Sync listener, local dirty/pending tracking, authoritative read and merge | Controlled remote event during save; unrelated remote and local edits both survive. |
| Redux has an item PouchDB lacks, or PouchDB has an item Redux lacks | Which snapshot deletion/save treats as authoritative; fresh database reads and merge rules | Test each meaningful divergence; neither source silently erases a surviving item. |
| Keep Contents races with folder creation, media creation inside the target, or a move of the target/ancestor | Delete-time folder/item reads, revision conflict retry, parent lookup, and the chosen Keep Contents destination | Controlled competing mutation; surviving items land under the intended surviving parent/ancestor, not merely any valid `folderId`. |
| A retry sees a revision conflict or deletion partially succeeds | Item-level versus folder-document writes, durable checkpoint, retry input, and rollback behavior | Assert final documents and references after retry; no lost item, stale folder, duplicate, or false saved acknowledgment. |
| Provider cleanup fails after only part of a deletion; church/controller changes while work is pending | Provider result adoption, cleanup ownership, captured DB/scope, and UI/Redux commit guards | Fail cleanup after durable app changes, switch scope, then retry; cleanup remains scoped to the original owner and adopted media is preserved. |

Do not infer semantic success from valid documents alone. For Keep Contents, explicitly state the expected parent for each surviving item after the concurrent folder tree changes.
