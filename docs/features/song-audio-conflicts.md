# Song audio and editor conflicts

## Confirmed product intent

Authorization: production correctness request, October 14, 2026.

- Attaching or removing an MP3 changes only audio and saved revision/audit metadata. It preserves unrelated persisted fields, pending local edits, the original unrelated-field comparison baseline, and unresolved remote conflict state.
- A competing controller's lyrics remain protected through an audio operation and ordinary autosave. Only the explicit Keep Editing Mine decision permits replacing the conflicting content.
- Use Their Changes adopts the remote document and retires queued local autosaves.
- Async operations retain their original database and church. Song A results cannot change Song B or another church's editor, even for matching document IDs.
- Delayed autosaves must not restore obsolete audio; a save acknowledgment must describe an actual persisted write.

## Implementation and verification

### Concurrent lyric editing (October 26, 2026)

Authorization: the Song v2 concurrent slide editing request.

- Text typed during a formatting debounce is protected immediately. Remote
  updates and save acknowledgments must not declare this input saved or replace it.
- Ordinary lyric formatting preserves the identity of each section occurrence
  and page, including title and blank slides. Overflow creates/removes pages
  without borrowing another section's slide or box identities.
- Disjoint canonical lyric edits use the authored baseline to merge against
  the latest section before formatting. Ambiguous overlaps and concurrent
  structural/layout changes retain the draft and use existing conflict choices.
- Child-document replication refreshes the affected active song. Library
  projections refresh for root/arrangement changes; slide-only notifications
  must not scan the library. Revision-checked writes remain mandatory.
- Song migrations, schema changes and v2 deletion remain outside this change.

`persistSongAudioAttachment` reads the original database's latest document and uses Pouch revision checks to write the audio field while preserving unrelated data. It returns the exact written document and returned revision. A competing write can reject with 409; it is not silently overwritten.

`applyPersistedSongAudio` patches audio and revision metadata without accepting a new lyric baseline. It patches audio in a pending remote document so either conflict decision retains the completed audio operation. The store reschedules pending local intent using the preserved baseline, retires superseded work before writes, and suppresses stale acknowledgments after newer intent/audio. Partial acknowledgments advance only the fields actually written. `SlideEditor` captures the database and mutation owner and suppresses publication after owner retirement.

The standalone song drawer also omits the cached name from audio-only patches and suppresses late publication after database/church changes or unmount.

Regression evidence: controlled-revision/deferred-promise scenarios in `client/src/store/store.test.ts`, owner isolation in `client/src/store/itemSlice.test.ts`, concurrent renames/unmount in `client/src/components/SongSections/ViewSongSectionsDrawer.test.tsx`, and metadata preservation/failure ordering in `client/src/utils/persistSongAudioAttachment.test.ts`.
