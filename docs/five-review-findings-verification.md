# Five code review findings — October 30, 2026

## Goal

Implement the five owner-requested fixes on `in-progress`, preserving the current
Media queue, Activity ownership, persistence, and video architecture.

## Existing architecture

ControllerContextWrapper supplies TransferProvider, which serializes folder
jobs. Media captures the concrete PouchDB and session; `loadMediaLibrary` reads
schema-v2 folder and item documents. Per-item tombstones remain revision-bound;
reference sweeps roll back on failure. Keep Contents uses saved-route repair and
the merge-aware library flush. OverlayEditor owns the debounced draft, Redux
listeners handle selected saves, and `persistExistingOverlayDoc` handles outgoing
documents. Both video consumers already distinguish `loopOnly` from transport.

## Before behavior

Queued folder jobs use old Redux membership after navigation. A session-invalid
retry can remain queued in Activity. Pending drafts can call a new owner's save
callback. Missing Activity reports a duplicate deletion. Loop off can rebase an
unknown-duration clock beyond the real clip end.

## After behavior

Queued jobs read their originating database, skip removed folders, and fail closed
on read errors. Invalid queued work retires Activity and its actions. Drafts keep
their own callback, source, and full owner through replacement/commit/unmount;
session checks protect delayed writes. Active Media deletion stops starting new
database or provider work when its church session changes; an operation already
in flight may settle against its captured owner. Missing Activity fails
accurately before registering a handoff. Unknown-duration Loop changes send
policy only.

## Product Decision Check

All changes are authorized by the current five-findings request, consistent with
the confirmed Media folder deletion, overlay synchronization, and video playback
contracts. Clarifications are recorded in those contracts. No open product choice.

## Behavior intentionally unchanged

FIFO/deduplication; safe cancellation checkpoints; revision/conflict rollback;
provider cleanup and finalization after durable deletion while the originating
church session remains current; ordinary retry cancellation restoring prior
recovery; remote-draft conflict choices; selected overlay autosave; known-duration
rebasing; natural final-frame retention; explicit restart/seek; output
preparation, transitions, and stream transparency.

## Acceptance criteria

Persisted membership wins after a queued delay and route retirement. Reads cannot
fail open. Missing folders cannot delete orphaned media. Logout/session changes
cannot start new deletion. Retry rejection clears Activity/unload/Cancel/recovery.
Same-ID overlays under different databases cannot exchange drafts. Both output
players preserve position on policy-only Loop changes and still accept explicit
transport and natural completion.

## Proposed implementation

Use existing authoritative reads and handoff retirement at queue start. Extend
the existing draft identity with its owner and retain callbacks/baseline on that
identity. Add a commit guard to the existing revision-retrying overlay writer.
Extend the existing `loopOnly` condition to unknown duration. No new manager,
queue, persistent shape, or sync mechanism.

## Affected surfaces

Media confirmation/queue/Activity, route unmount, church session, PouchDB,
references/provider assets, overlay selection and draft autosave, ItemSlides live
controls, HLS/native browser media, Electron prepared surfaces, and existing
presentation Redux/Firebase/IPC consumers. No server API or permission change.

## Risks / edge cases

Queue waiting; navigation; same-ID church switches; logout during reads; cancelled
retries; late cleanup/finalization; failed authoritative reads; dirty remote
replacement; repeated Loop changes; completion versus restart/seek. Reads run
per queued job, without extra per-frame work or duplicated shared state.

## Questions requiring user input

None.

## Verification

Required: failure-derived Media/draft/controls tests; HLS/Electron policy/end/seek
tests; related queue, persistence, controller, store and DisplayWindow suites;
client type check, lint, strict build, complete diff and production-path review.
Optional: physical projector/monitor, real GPU/HLS decoding, paired hardware.

## Root causes and changed paths

| Finding | Root cause | Resolution and changed paths |
| --- | --- | --- |
| 1. Queued folder membership | Route retirement selected request-time Redux instead of persisted membership. Retrying failed rows had the same ownership risk. | `useMediaLibraryController.tsx`: both modes load the captured DB at queue start. Subtree retries refresh the target and retain only current members. Target, subtree, rows, parent, and initial file activities come from that read. Missing folders skip mutations; read failures stop. Keep Contents merges only UI changes since the read onto its persisted baseline, so stale fields cannot undo a move while newer edits survive. |
| 2. Retry session boundary | A rejected session check returned after the queue had published queued Activity. | The existing handoff retires and `removeTransfer` clears the Activity entry and every registered action at the actual retry-start boundary. Invalid-session queued cancellation also retires. Valid-session cancellation still restores the prior failure, progress, errors, and working recovery. Upload cleanup completion becomes the durable checkpoint before refreshing deletion membership. |
| 3. Overlay ownership | The hook replaced outgoing callbacks with the next selection's callback; matching IDs hid owner changes. | `Overlays.tsx`, `OverlayEditor.tsx`, `useOverlayDraft.ts`, `persistOverlayDoc.ts`: retain owner, concrete DB, callback, and baseline with the draft. Compare full owner scope before Redux publication. Session checks protect outgoing reads, puts, and conflict retries; logout deliberately discards pending work. Selection, replacement, debounce, and cleanup retain the correct destination. |
| 4. Missing Activity | Optional queue access returned the same null value as duplicate detection. Retiring a rejected handoff could leave temporary actions registered. | `useMediaLibraryController.tsx`: report Activity unavailability before creating a handoff; retain duplicate feedback when an available queue rejects the folder; remove rejected handoffs/actions. No direct-deletion fallback. |
| 5. Unknown-duration Loop | Elapsed transport position cannot be wrapped without duration, so Loop off could expose a position beyond the real end. | `VideoBackgroundControls.tsx`: use existing `loopOnly` when duration is unavailable/invalid. `buildVideoPlaybackCue` already preserves the marker. HLS strips policy-only cues from transport; Electron maps them to the existing loop preference. Both consumers needed verification, without a new implementation. |

The Media production diff exceeds the localized-fix warning threshold because it
addresses two deletion modes, queue/retry session boundaries, and mounted versus
retired UI reconciliation. The alternatives considered were retaining snapshot
fallbacks or adding another deletion/persistence owner. Local helpers reuse the
existing reader, queue, handoff, and revision-aware flush; there is no new global
state, manager, utility module, or persisted field.

## Regression evidence

All new tests use controlled promises, revisions, metadata, clocks, or events.
Existing same-session assertions remain. Cross-session expectations now verify
that work stops before further persistence and leaves the new church untouched.

- `Media.test.tsx`: hold folder A; queue B; change only persisted B membership
  and parent; retire Media; release A. Assert a fresh originating-DB read,
  retained moved row, no reference sweep/tombstone/provider deletion for it,
  correct parent, and fresh Activity files. Repeat Keep Contents while mounted
  and with newer UI edits during held route repair. Also cover removed folders,
  authoritative read errors, logout during reads, queued retry run/cancel after
  session change, ordinary retry cancellation and executable recovery, another
  membership change while retry waits, missing Activity, and rejected handoff
  cleanup. `keeps deletion recovery after upload cleanup succeeds but its fresh
  membership read fails` proves that Retry resumes deletion without repeating
  the completed cleanup step. Moved retry rows are omitted from Activity rather
  than counted as removed. A separate test changes the active content-database
  owner during provider cleanup while keeping the Redux session number fixed;
  no later route repair, folder flush, navigation, or new-church write begins.
- `useOverlayDraft.test.tsx`: same-ID/different-owner replacement, outgoing
  selection callback, next draft debounce/unmount, and accepted remote replacement.
- `outlineSwitch.integration.test.tsx`: real Overlays, Redux reducers/listeners,
  draft hook, and revision-checking DBs; A draft stays in A when B selects the
  same or another ID, when the old editor unmounts, and across debounce; logout
  prevents any put. The lightweight editor surrogate forwards the production
  owner/callback boundary.
- `OverlayEditor.servicePlan.test.tsx`: the real editor and draft hook verify
  owner forwarding for identical IDs and outgoing/unmount commits. Display,
  drawers, and style controls are isolated; ownership is not mocked away.
- `persistOverlayDoc.test.ts`: session retires during read; no put follows.
  Existing revision-conflict and caller-revision protections remain asserted.
- Controls: absent, zero, NaN, and infinite duration after several wraps produce
  policy-only cues; repeated Loop changes and explicit Restart still work.
  Known-duration wrapping remains a transport cue.
- HLS/native and Electron: a policy position of 144 seconds must not replace the
  actual 18-second frame of a 40-second clip. Assert no seek/play/pause/reload,
  progress to the next natural end, final-frame retention, Loop back on, and
  subsequent explicit restart/seek. Existing paused/cue-less tests also run.

## Exact verification commands

Commands ran from the repository root. The broader regression run included the
Media, overlay, queue, persistence, controller, store, and DisplayWindow suites.

```powershell
npm.cmd test --prefix client -- --runInBand --silent src/containers/Media/__tests__/Media.test.tsx src/pages/Controller/outlineSwitch.integration.test.tsx src/hooks/useOverlayDraft.test.tsx src/utils/persistOverlayDoc.test.ts src/components/VideoBackgroundControls/VideoBackgroundControls.test.tsx src/components/DisplayWindow/ElectronMediaSurfacePool.test.tsx src/context/transferContext.test.tsx src/utils/mediaDocUtils.test.ts src/utils/flushMediaLibraryDoc.test.ts src/utils/controllerMediaRouteFolders.test.ts src/utils/mediaReferenceSweep.test.ts src/utils/mediaFolderMutations.test.ts src/utils/mediaOperationClaims.test.ts src/pages/Controller/useControllerPageLifecycle.test.tsx src/containers/Overlays/OverlayEditor.servicePlan.test.tsx src/containers/Overlays/Overlays.selection.test.tsx src/utils/overlayRemoteSync.test.ts src/utils/videoBackgroundPlayback.test.ts src/containers/ItemSlides/ItemSlides.test.tsx src/utils/electronMediaSurfacePool.test.ts src/store/store.test.ts src/store/presentationSlice.test.ts src/components/DisplayWindow/__tests__ src/containers/FullscreenPresentation.test.tsx src/pages/__tests__/ProjectorFull.test.tsx src/pages/__tests__/Monitor.test.tsx src/pages/__tests__/Stream.test.tsx
npm.cmd test --prefix client -- --watchAll=false --runInBand --silent src/containers/Media/__tests__/Media.test.tsx src/containers/Overlays/OverlayEditor.servicePlan.test.tsx src/pages/Controller/outlineSwitch.integration.test.tsx src/hooks/useOverlayDraft.test.tsx src/utils/persistOverlayDoc.test.ts src/components/VideoBackgroundControls/VideoBackgroundControls.test.tsx src/components/DisplayWindow/__tests__/HLSVideoPlayer.test.tsx src/components/DisplayWindow/ElectronMediaSurfacePool.test.tsx
npm.cmd run type-check --prefix client
npm.cmd run lint:check --prefix client
npm.cmd run build:strict --prefix client
git diff --check
```

Results in the final broad run: **52 suites, 1,017 tests passed**. The focused
eight-suite run passed **222 tests**, and the full Media suite passed **72 tests**.
TypeScript passed with no errors. Lint passed with zero warnings (also rerun by
the strict build). The strict production build passed; it reported the existing
CSS fixture URL warning and large-chunk warnings. `git diff --check` passed.

The first sandboxed build could not traverse parent directories while resolving Vite configuration; the strict build was rerun successfully outside the Windows sandbox. Dependency package versions in the sibling installation matched the main lockfile; a local dependency copy was restored before the final combined run, with no manifest or lockfile changes.

Required verification gaps: **None**. Optional additional confidence not performed: physical outputs, real GPU/HLS decoding, paired hardware, and a release-wide/full-repository CI run. Controlled media tests verify state, play promises, metadata, seeks, frame events, and completion, without measuring hardware frames.

## Code-review record

### Findings

Critical: None. High: None. Medium: None. Low: None unresolved in the reviewed
workflow. Review found and corrected stale retry membership, Keep Contents
replaying stale mounted UI fields, rejected-handoff registrations, and preserving
deletion recovery after durable upload cleanup followed by a failed read.

### Product authorization status

Authorized: all five corrections are explicitly requested by the owner and align
with the confirmed contracts named above. Contract updates record these boundaries.
No unapproved product behavior, new synchronization mechanism, or permission change.

### Open questions / assumptions

None. A session transition stops new destructive work and retires the Activity
entry; an already-started database or provider operation may settle against its
captured owner. If a media tombstone commits immediately before the session
changes, provider cleanup may remain unfinished until separately reconciled.

### Verification gaps

Scope: **workflow review**, not release-wide production readiness. **Entire change
set inspected**, including all modified tests, contract text, and release copy.
Inspected tests are distinguished from the executed commands listed above.
Required checks all passed; optional hardware checks are listed above.

Production-context verification: **Pass**. ControllerContextWrapper supplies the
real TransferProvider around Media. Queue registration, retirement, serialized
drain, action removal, and beforeunload ownership were traced in the provider and
covered by its real suite; the Media harness reproduces those queue semantics and
uses the real persisted library reader. Overlay tests exercise real reducers,
listeners, database identity middleware, and draft hook; the additional real-editor
test verifies prop forwarding. The actual editor's pending-marker callbacks guard
their originating owner. Selected saves still follow existing scoped Redux
listeners; outgoing saves use the captured DB and guarded writer. ItemSlides to
presentation cue publication, generation ordering, FullscreenPresentation,
DisplayWindow lanes, HLS, Electron prepared surfaces, and Stream's background
exclusion/transparency were inspected against their test wrappers.

| Invariant | Production entry / authority; reader and writer | Adversarial boundary and exact evidence | Result |
| --- | --- | --- | --- |
| Fresh membership survives queue delay | Media -> TransferProvider -> captured PouchDB -> reference sweep / revision tombstone / provider cleanup | `reads persisted B membership for queued ...`: A held, B queued, persisted move/parent change, navigation, B starts. `refreshes membership again ...` repeats for queued retry. | Pass |
| Keep Contents preserves current intent | Captured DB baseline plus UI changes since read -> existing merge-aware flush | `keeps persisted membership while merging newer UI edits ...`: persisted move plus a later UI rename while route repair waits; exact destination and name asserted. Existing concurrent additions/removals tests remain unchanged. | Pass |
| Unavailable authority cannot authorize deletion | `loadMediaLibrary` -> queued job boundary | `skips a removed folder ...`, `fails safely when the authoritative ... read fails`: no additional media/reference/provider writes. | Pass |
| Session retirement terminates queued retry | Queue start/cancel -> handoff -> `removeTransfer` -> provider action map / unload effect | `removes old-session retry Activity ...`: enqueue behind A, retire session, run or cancel, drain, invoke captured retry again; no entry, Cancel, executable retry, or new tombstone. Same-session cancellation restores failure and then completes through recovery. | Pass |
| Draft ownership spans selection/lifetime | Overlays -> real OverlayEditor -> draft owner/callback/source -> original DB writer; Redux publication independently guarded | Same-ID A/B owner switch, selection change, debounce, unmount, accepted replacement, logout, and session retirement during DB read in the exact tests above. B is unchanged. | Pass |
| Loop policy cannot become transport | Controls -> existing cue builder -> presentation/store -> HLS / Electron | Unknown-duration controls after several wraps; 144-second policy versus actual 18-second playhead; timers, natural end, Loop on, restart, and seek. Existing remote store tests carry policy at unchanged slide time. | Pass |

Owner retirement matrix (existing ownership retained):

| Concern | After Media route retirement |
| --- | --- |
| Operation | Queue runtime continues after Media route retirement only while its original church session remains active. A changed session stops it at a safe checkpoint; an operation already in flight may settle against the captured owner. |
| Activity | Provider retains valid active/terminal state; invalid-session queued work is removed. |
| Cancel | Provider queue owns the action and safe checkpoint. |
| Retry deletion | Detached handoff uses the original DB/session and refreshes membership before deletion; a changed session retires the Activity and its actions. |
| Retry cleanup | Existing handoff/provider retain recovery after late cleanup/finalization failure within the original session; a cleanup step that resumes deletion requires that session. |
| Dismiss | Provider/handoff remove transfer and actions; active folder work cannot be dismissed. |
| Late completion/failure | Original runtime publishes through the handoff; route/Redux/navigation guards prevent stale UI commits. |

Sibling-pattern search covered individual and folder deletion, both retry kinds,
Keep Contents, other captured-DB Media paths, overlay writer/callers and draft
selection/reset paths, Continue/send cue creation, both media consumers, and remote
presentation listeners. Persisted formats are unchanged; the optional writer
guard preserves existing callers. Reference rollback, tombstone-before-provider
cleanup, missing-media handling, and Canva reference checks remain intact.

### Pattern / learning opportunities

The existing persistence/lifetime skills already describe these failures. Tests
now enforce their concrete interruption boundaries; no new repository policy or
manager is needed.

### Final readiness

Ready. All five requested findings are resolved for the affected workflow, all required checks passed, and no required follow-up remains. This is not a release-wide production-readiness claim.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes.
- Legacy/persisted-state compatibility reviewed: Yes.
- Identity-switch test reviewed or added: Yes.
- Unmount/lifetime test reviewed or added: Yes.
- Contract round trip traced: Yes (draft -> document; policy -> output).
- Validate/use security boundary reviewed: Yes (session checks before delayed work and writes).
- Retry-state authority reviewed: Yes.
- Owner-retirement handoff reviewed: Yes.
- External side-effect adoption/compensation reviewed: Yes (revision tombstone before cleanup).
- Authorization/data-projection reviewed: Not applicable; no permissions, projections, credentials, or endpoints changed.
- Production entry point, runtime context, and test composition compared: Yes.
