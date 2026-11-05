# Song v2 concurrent editing verification

Branch: `in-progress-3`, baseline `93d1b7ff`.
Test data: isolated synthetic `Better` fixtures; no live demo documents.

Implementation status: **COMPLETE for the user-approved local verification scope**.
On October 27, 2026, the user selected “Finish with local PouchDB counts only.”
The implementation and required local verification are complete; authenticated
CouchDB HTTP measurement is outside the agreed scope.

## Confirmed failure and action trace

The original formatter called `createNewSlide()` for every lyric page, title
and blank. An ordinary Verse 1A change replaced all five slide identities in
the reproduction. The physical intent was five slide creates, an arrangement
rewrite, and five old-slide removals, rather than one page edit.

| Stage | Browser B state / physical result before the fix |
| --- | --- |
| Input event | New Verse 1B text exists in component input / `pendingBoxEditRef`; Redux is still clean during the 200 ms debounce. |
| A commits | A reconstructs Verse 1, generates new slide IDs and writes its slide documents plus `song-v2:arrangement:better-test:master`. |
| Replication | `controllerInfo` broadcasts changed physical documents. `useControllerPageLifecycle` calls `updateAllDocs`, followed by active-song hydration in the store listener. |
| Remote adoption before B's debounce | The store sees a clean editor and dispatches `setActiveItem(remote)`. B's pending text is absent from the replacement state. This is the reproduced lost-input path: B's change was never persisted. |
| B commits before remote adoption instead | B's canonical Verse 1 text competes for the same arrangement document. The writer rejects it with `SongV2ConcurrentEditError`; this is a distinct, confirmed conflict, not a successful write followed by erasure. |
| Save acknowledgment | The old v2 `markItemPersisted` branch could mark a differing draft clean and queue automatic remote adoption. The new controlled in-flight-save tests prevent an older acknowledgment from acknowledging pending/newer input. |

Two independently saved local Pouch databases also create eventual revision
branches when neither browser has received the other save. This differs from
an immediate `put`/409 conflict; see the [PouchDB conflict model](https://pouchdb.apache.org/guides/conflicts.html).
The tests exercise both forms with real IndexedDB PouchDB instances.

## Implemented changes

- `overflow.ts`: retain title/blank identities and match lyric section
  occurrences and page ordinals. Preserve existing box IDs; allocate identities
  for genuine new pages. Use section-specific templates so overflow does not
  borrow identities or layouts from another section. Preview offsets use the
  same templates.
- `mergeLyricText.ts` and `songV2Writer.ts`: derive disjoint text patches from
  the authored baseline, merge into current canonical lyrics, then format.
  Preserve revision checks and reject overlaps, rich-text/structural/layout
  ambiguity and unrelated mutations. No CRDT or persisted schema was added.
- `SlideEditor.tsx`: mark accepted box/section input pending immediately.
  `store.ts` flushes owned pending work before remote reconciliation and save
  acknowledgment, including the older broad-refresh path. Automatic adoption
  rechecks cleanliness after flushing; explicit operator choices remain explicit.
  LyricsEditorPanel also protects accepted local input before its next render.
- `itemSlice.ts`: acknowledge the exact authored save, adopt merged remote
  content only for fields without newer local changes, and preserve unresolved
  revision drafts through late acknowledgments. Conflict revision references
  are runtime state and are excluded from persisted song documents.
- `songV2ReplicationConflicts.ts`: inspect native revision branches, find a
  common authored ancestor and merge disjoint plain lyrics. Retire losing
  revision leaves only after a validated merge or explicit operator choice.
  A later unseen branch is retained. This does not enable logical song deletion.
- `songPersistence.ts`: reuse the already-loaded physical snapshot during an
  autosave, retry a commit-time 409 once against the original authored baseline,
  and leave successful-save cleanup maintenance off the common save path.
  Reopening an independently edited song also reconciles mergeable branches.
- `useControllerPageLifecycle.ts` and `store.ts`: identify/coalesce logical v2
  song changes; ignore unrelated slide changes; load the active song with
  keyed reads; refresh root/arrangement library projections without scanning the
  library. Guard stale reads, saves and database changes.
- `useGlobalBroadcast.ts`: retain documents from all debounced batches and
  detach from the original captured channel on cleanup.
- `dbUtils.ts`: invalidate superseded broad library reads. Preserve bootstrap,
  legacy/non-song and item-list refresh behavior.
- Controller Item route: report preserved, unresolved revision conflicts on
  reopen instead of silently showing an arbitrary winner.

The additional code addresses three different ownership boundaries: pending
component input, authored section text, and eventual database revision branches.
Reusing only the physical writer could not solve all three. Existing owner
queues, formatting, conflict controls and Pouch revision validation remain in use.

## Measured operations

These are actual instrumented PouchDB API calls, **not total CouchDB HTTP
traffic**. Keyed `allDocs` calls count as one API call each. Bootstrap, fixture
creation and final reload reads are outside the save measurement window.

| Reproduction window | `get` | `allDocs` | `put` | `remove` |
| --- | ---: | ---: | ---: | ---: |
| Before: A save, B rejected save, one broad library refresh | 13 | 11 | 6 | 5 |
| After: both saves succeed using captured snapshots | 2 | 4 | 4 | 0 |
| Additional eventual-branch reconciliation, when needed | 5 | 2 | 1 | 1 |

Before: 24 read API calls and 11 mutation calls, with B rejected.
After: 6 read API calls and 4 writes, with both text changes persisted.
Each ordinary save writes only the edited slide and its canonical arrangement.
The root, title, blank, unrelated lyric slides and other arrangements are not
rewritten. Branch reconciliation's removal is a losing revision leaf, not a
song or referenced slide deletion.

The common remote slide notification uses one root read and two keyed child
reads for the active song. Three coalesced notifications perform the same one
load. Unrelated slide notifications perform zero document reads. Tests reject
unkeyed library scans on this path.

The user selected local PouchDB counts only on October 27, 2026. No CouchDB HTTP
totals are claimed. No authenticated CouchDB connection succeeded, and no
external test database was created or changed.

## Convergence and regression evidence

`client/src/utils/songV2ConcurrentEditing.test.ts` uses real formatting, reducers,
the safe writer, IndexedDB and independently replicated Pouch databases.

- A appends `1` in Verse 1A while B appends `1` in Verse 1B: **both survive**.
- B receives A while B holds a draft: buffered local input survives and saves.
- Both validate before either shared arrangement commits: bounded revision-safe
  retry converges.
- Both browser databases save before either edit replicates: native branch
  reconciliation converges through targeted refresh and through reopen.
- Both databases reload the same combined canonical lyrics and rendered pages.
- Ordinary edits retain all existing slide and box IDs; exact physical writes
  and operation counts are asserted.
- Overlapping edits reject or retain revision leaves; explicit Mine/Their
  decisions preserve canonical/rendered consistency.
- A third, unseen revision arriving after a conflict decision is not discarded.
- Failure retiring a revision after the merged write is durable can be retried
  without repeating that write.
- Overflow growth, shrink and a text merge involving a new page remain consistent.
- Repeated occurrences and genuinely new sections receive distinct identities.

`store.test.ts` controls the pending-input, autosave-in-flight, older-read-after-
save, broad-refresh, explicit-decision and same-ID/different-database boundaries.
Mounted SlideEditor tests verify the immediate dirty signal before formatting.
Lifecycle/broadcast tests verify targeted notifications and retained batches.
The Controller Item test verifies the preserved-conflict message on reopen.

## Scope and remaining limits

- Concurrent independently replicated changes that produce different page
  reference graphs require explicit conflict review. Reflow against an already
  received remote text edit merges automatically when unambiguous.
- Same-page revision branches, structural/layout changes, rich text and missing
  or compacted common ancestors are conservatively retained for review.
- Equivalent offsets in repeated lyric lines/runs are ambiguous and also
  require review when another text change competes.
- A fresh reopen with an unresolved ambiguous conflict reports that the saved
  versions are preserved. The existing Mine/Their controls operate in an editor
  that still has its draft open; this change does not add a revision-history UI.
- The automated two-editor reproduction uses real independent Pouch replicas
  under Jest/jsdom, not two manually operated production browser windows.
- No migration commands, live-song edits, schema changes, production merges or
  logical v2 deletion enablement were performed. The three pre-existing local
  JSON files were left untouched.

## Verification

- Related client run: **47 suites, 813 tests passed**. After the final automatic
  adoption metadata guard, the focused editor/store run also passed:
  **10 suites, 269 tests**.
- Server song schema/audio regression run: 60 tests passed:
  `node --import tsx --test server/songSchemaV2Migration.test.js server/songAudioUploadGuard.test.js server/songAudioStorage.test.js`.
  Migration tests use in-memory clients; no migration CLI or live migration ran.
- `npm.cmd run type-check` passed.
- `npm.cmd run lint:check` passed with zero warnings.
- `npm.cmd run build:strict` passed, including lint and the Vite/PWA build.
  The initial sandboxed build failed on esbuild ancestor-directory access;
  the authorized build outside the sandbox passed. Vite reports asset/CSS and
  large-chunk warnings; no build errors remain.
- `git diff --check` passed.
- Read-only source trace checked `controllerInfo.tsx` replication events;
  no provider or server transport change was needed.

Client selection command (run from `client/`):

```powershell
node node_modules/jest/bin/jest.js --watchAll=false --runInBand --testPathPatterns='song|Song|activeItemSlides|overflow.test|slideCreation.test|ownedItemContentMutation|itemSlice.test|store.test|SlideEditor.test|LyricsEditor|dbUtils.test|useControllerPageLifecycle|useGlobalBroadcast|mergeLyricText|monitorSlideFormatter|DisplayWindow.corePaths|DisplayBoxTransitionStage.test|Controller/Item.test|formatter.test|FormattedTextEditor'
```

The one changed v2 autosave expectation now requires merged sibling content to
be adopted by the exact authored acknowledgment, without an automatic "clean
but different" remote adoption step. Two read-option expectations now require
`conflicts: true` so reopening cannot silently ignore competing revisions.
Conflict/revision assertions were retained, not weakened.

## Final review

Scope: workflow review of concurrent song editing, persistence and remote refresh.
This is not a production-branch readiness claim.

### Findings

No unresolved code correctness finding or required verification gap remains
within the user-approved local verification scope.

### Product authorization status

Authorized by the current concurrent-editing request and
`docs/features/song-audio-conflicts.md`. Explicit conflict choices, stable
identities, disjoint merging and targeted refreshes implement that request.
The native revision-leaf cleanup is conflict resolution, not logical deletion.

### Open questions / assumptions

No open authorization question remains. The user chose local PouchDB measurement.
Plain canonical lyrics are the only automatic text merge domain; ambiguous
richer/structural edits retain drafts.

### Cross-boundary evidence

| Invariant | Controlled boundary / code | Evidence |
| --- | --- | --- |
| Typed text cannot be erased by remote input | `scheduleBoxEdit`, owned pending flush, `bufferRemoteItemUpdate` | Immediate pending signal plus store debounce and broad-refresh tests |
| Acknowledgments describe saved intent | `markItemPersisted`, mutation versions, authored baseline | In-flight-save/new-input and unresolved-conflict late-ack tests |
| Independent writes preserve both edits | `mergeConcurrentLyrics`, native conflict reconciliation | Two real independently replicated databases, both save orderings and reloads |
| Old asynchronous work cannot replace newer state | Refresh request identity, baseline/owner guards, broad-read invalidation | Older response after save; same-ID database switch; invalidated manifest tests |
| Conflict choices cannot erase a later writer | Captured revision leaves and current-revision validation | Third unseen revision test; Mine/Their action integration tests |
| Persisted/rendered contract agrees | Canonical merge -> formatter -> safe writer -> reload | Physical document, overflow and replica round trips |

Cross-boundary and sibling-pattern review performed. Legacy/persisted shapes,
identity switches, subscription cleanup, owner retirement and revision checks
reviewed. External upload/provider compensation and changed authorization
projections are not applicable; neither boundary was changed. The production
route/provider path was compared with mounted component, store and replica
tests. Live CouchDB transport measurement is outside the final verification
scope by the user's decision.

### Final readiness

**Complete for the agreed local workflow scope.** The local workflow regression
checks pass. Optional manual production-browser replay was not performed; the
real replica and mounted/store tests are the automated reproduction evidence.
This does not claim production-branch readiness or measured CouchDB HTTP totals.
