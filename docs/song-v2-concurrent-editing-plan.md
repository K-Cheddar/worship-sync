# Song v2 concurrent editing

## Goal
Preserve independently authored Verse 1A / Verse 1B edits, keep automatic
formatting, and avoid library-wide reads for a child-document notification.

## Existing architecture
SlideEditor holds a 200 ms pending box mutation, then formats a complete
arrangement. Redux autosaves after 1500 ms. The v2 writer compares authored
physical-document intent against current revisions. Replication broadcasts
documents; the controller refreshes the library and the store reloads the song.
Existing owner-scoped deferred mutations and revision-checked writes are reused.

## Before behavior
Formatting allocates fresh slide IDs. Different pages replace one canonical
lyrics entry. Pending component input is invisible to remote reconciliation.
The v2 acknowledgment can declare a differing draft clean; automatic remote
adoption can then replace it. Every replication batch refreshes all documents.

## After behavior
Keep section/page identities and box identities; merge disjoint canonical text
changes against the authored baseline and reformat before revision-checked
writes. Protect accepted pending input immediately. Acknowledge only the saved
intent. Refresh affected active songs and library metadata with scoped reads.

## Product Decision Check
Authorization: the current concurrent-editing request and
`features/song-audio-conflicts.md`. Overlapping edits remain explicit conflicts
with both drafts retained. No migration, schema change, deletion enablement, or
production merge is authorized or needed.

## Behavior intentionally unchanged
Automatic overflow, explicit conflict choices, audio-only updates, tenant/owner
isolation, revision validation, legacy content and item-list synchronization.

## Acceptance criteria
The ten regression scenarios in the request; physical-document/call counts;
Song v2, active-editor, formatting and persistence tests; type-check, lint, build.

## Proposed implementation
Correct existing formatting and acknowledgment boundaries. Add a bounded,
conservative text-only three-way merge at the safe writer. Coalesce v2 remote
notifications by logical song and sequence their asynchronous loads.

## Affected surfaces
Controller Item route -> SlideEditor / LyricsEditorPanel -> Redux listener ->
local PouchDB -> existing Couch replication. Browser and Electron share this
path. Authentication and display composition remain outside the changed path.
Tests must use actual formatters, reducers, writer and real IndexedDB PouchDB;
mounted editor tests additionally verify the input/debounce interaction.

## Risks / edge cases
Overlapping text, overflow growth/shrink, repeated sections, partial writes,
lost acknowledgments, typing during saves, old loads after saves, owner changes.
Conservative conflicts are preferable to guessing across structural changes.

## Questions requiring user input
None.

## Verification
Capture pre-fix failures and operation counts on isolated fixtures; run the
requested focused suites and static/build checks, then self-review the complete
diff and interruption boundaries. Never use the live demo as a test fixture.
