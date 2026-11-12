# Linked-video reliability implementation and review

Worktree: `worship-sync-2`, branch `in-progress-2`, baseline
`49d252e7b1f1694ee93004c86f24d141e7503fb3`. Recorded November 12, 2026.
No merge to master or publication was performed.

## Root causes and changes

| Confirmed issue | Cause | Change |
| --- | --- | --- |
| Failed relink damaged the previous reference | Native registration changed before renderer validation and library persistence | Stage a separate trusted candidate; validate it; conditionally persist a checkpoint; atomically adopt under the original native asset ID |
| Saved service/slide references could become stale | Saved consumers embed the native asset ID | Retain both library and native IDs; invalidate future URL acquisitions while respecting active leases |
| Interrupted relink had uncertain ownership | Pouch, native registry, IndexedDB and provider cleanup are separate commits | Durable previous/proposed snapshots, native registry-only reconciliation, conditional rollback and retained Activity recovery |
| Restart hid an incomplete relink | The durable checkpoint survived, but its Activity action existed only in React memory | Discover checkpoints from the authoritative library after initialization in the long-lived desktop manager; reconcile native status and restore the existing action without startup cleanup |
| Resumed rollback could erase later edits | Current values were used as the older operation's comparison baseline | Persist immutable proposed fields and compare against those; preserve later thumbnail, dimension and audio edits |
| Replacement left old Mux storage | Old cloud references were cleared without retirement | Save cleanup IDs with the replacement and reuse reference-checked, church-authorized cleanup |
| Upload could use old native bytes during recovery | Shared replacement metadata could precede native adoption | Require selected, persisted and native content identity agreement before linked upload; serialize overlapping operations with existing claims |
| Cloud-registration retry could recreate a deleted item | Missing-row retry reused the initial-import creation path | Cloud patch requires an existing authoritative row; the item writer also refuses recreation if deletion wins during its write |
| External jobs could follow a changed default folder | Finalization read the mutable device preference | Bind an opaque native directory selection at first start and retain it across retries |
| Fallback exposed incomplete final MP4s | Exclusive copy wrote directly to the final name | Copy to a temporary file, sync it, then publish exclusively and atomically; never overwrite an existing file |
| External finalization reread copied bytes unnecessarily | Temporary copy was separately rehashed | Hash the copy stream while retaining source identity checks, initial hash and final registration verification |
| Successful native cleanup retained destination bindings | The native job binding was never retired | Release the binding only after native cleanup succeeds; preserve it on failure and clear selection tokens only for the destroyed WebContents owner |

## Safety and recovery behavior

The original native registration remains playable throughout staging and failed
validation or persistence. Native adoption validates candidate provenance,
workspace, source availability and its original registration baseline. A private
committed-candidate identity prevents equal-timestamp races and supports
idempotent acknowledgment recovery. Device-local paths never enter shared data.

The Pouch checkpoint includes old cloud IDs, content identities and the previous
and proposed replacement-owned fields. Native uncertainty preserves the
checkpoint. Confirmed noncommit permits conditional restoration; unrelated
current edits survive. Registry status can be checked even with disconnected
drives. Activity retries capture their church/database and use the same media
operation claim as relink/upload. Recovery retires the Redux checkpoint too.

Restart recovery is owned by `DesktopVideoDownloadManager` inside
`ControllerContextWrapper`, alongside `TransferProvider` and above route
content. It waits for `media.loadStatus === "ready"`, captures the church and
PouchDB instance, reads the authoritative library, checks each native relink
status and rereads the item before registering an action. Per-database scan
guards, a checkpoint signature and deterministic Activity IDs suppress
duplicates. Church/database checks stop stale work; the existing retry helper
uses the normal media-operation claim. Startup discovery only restores Activity
state and never performs filesystem or Mux cleanup.

Same-content replacements preserve cloud storage and thumbnails. Changed content
updates the existing item, clears obsolete cloud metadata, commits local metadata
and invalidates output caches. A post-IndexedDB notification closes the interval
between native commit and thumbnail invalidation. Late thumbnail work can save
only against its expected content hash. Saved old revision URLs reacquire the
current native source; active leases release their old resource normally.

Cleanup rereads the authoritative v2 library and current in-memory references.
Unknown schema, unreadable rows and uncertain legacy cloud references preserve
storage. Shared references retain their asset. Existing server ownership checks
remain enforced; already absent Mux assets and ownership records complete
idempotently. Failed cleanup retains its durable checkpoint and Activity action.
Deleting a linked registration never deletes the operator's source file.

Native download destination bindings stay associated with their owning sender
while jobs remain active or retryable. Successful IPC cleanup retires the
binding after native cleanup resolves; a rejection retains it. Selection tokens
are removed when their owning WebContents is destroyed, without touching other
windows' selections or any active destination binding. Renderer IPC continues
to receive opaque selection IDs rather than arbitrary filesystem authority.

Native external jobs retain the originally selected directory, including after
preference changes and retries. A disconnected destination requires restoring
that directory and retrying. The dialog shows a compact local path with full-path
disclosure and unavailable state. Picker cancellation preserves a valid choice.

External publication uses exclusive hard-link creation where available. On
Windows filesystems without it, an absolute system PowerShell executable invokes
exclusive same-volume `File.Move`; paths travel through environment values,
not interpolated command text. The helper is hidden. Unsupported non-Windows
publication fails closed. A final filename never exposes a copy in progress.

The menu uses **Add files** and **Link local video**. Existing managed imports,
download Activity ownership, progress/speed/ETA, cloud authorization/quota and
stream transparency remain unchanged. The existing unreleased note was updated.
Optional **Show in folder** was omitted to keep the action surface focused.

## Performance evidence

`client/scripts/benchmark-external-video.mts` compared baseline HEAD and updated
finalization with a generated, non-sparse 512 MiB file. Four runs alternated
baseline/updated/updated/baseline on local Windows C: storage with warm OS caches.
The measurement includes final linked registration. It is not a USB benchmark.

| Publication | Baseline runs | Updated runs | Mean comparison |
| --- | --- | --- | --- |
| Hard links | 5023, 3974 ms | 3855, 3436 ms | 4.50 s → 3.65 s, about 19% faster |
| Forced unsupported hard links | 3711, 3455 ms | 4347, 4008 ms | 3.58 s → 4.18 s, about 17% slower |

The fallback trades process startup overhead for safe atomic publication. The
request prioritizes preservation over optimization; no fallback speedup is claimed.

## Verification

- Full focused run: **32 Jest suites / 505 tests passed**. Exact suite arguments
  are in `linked-video-final-tests.log`; this is not the entire repository suite.
- After the final proposed-snapshot correction: **7 affected suites / 149 tests
  passed** (`linked-video-final-recovery-tests.log`), including all relink,
  Media entry, local cloud-share and desktop manager tests.
- Independent reviewer executed the final relink suite: **21 tests passed**.
  Earlier independent runs covered nine core/pool suites (143 tests), four
  boundary suites (63 tests), and three cloud/relink suites (26 tests).
- `npm run type-check --prefix client` and `npm run lint:check --prefix client`
  passed again after the final correction.
- Strict native TypeScript for complete main/preload entry points passed:
  `tsc --ignoreConfig --noEmit --strict --allowJs --checkJs false --skipLibCheck
  --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM
  --jsx react-jsx --types node electron/main.ts electron/preload.ts`.
- `node --test server/providerStorageService.test.js`: **24 tests passed**.
- Renderer and Electron local builds passed before the last recovery correction;
  the renderer passed again afterward. The final Electron rerun is recorded below.
- `tsx scripts/smoke-linked-video.mts` passed with the pinned development tool
  resources: FFmpeg generated actual H.264/AAC files; stable-ID adoption,
  forced unsupported-hard-link publication, conflicts and source-preserving
  linked deletion passed. ffprobe confirmed the output video/audio streams.

Automatic approval review rejected a default Electron build because its Sentry
plugin would upload source maps. Local verification uses temporary configurations
with Sentry explicitly disabled, telemetry disabled and the auth token removed.
The production build configuration is unchanged. Existing CSS parser/test utility
and chunk-size warnings are recorded in build logs.

### Restart recovery and native cleanup follow-up (November 12, 2026)

- Focused Jest coverage passed: **14 suites / 280 tests**. The runs included
  desktop manager startup discovery, relink recovery, Media initialization,
  Transfer Activity, native IPC and downloader cleanup, external
  finalization/retry, authoritative Media Library reads, persistence, cloud
  cleanup, Mux upload, Media upload UI and cleanup Activity copy.
- `npm run type-check --prefix client`, `npm run lint:check --prefix client`,
  and strict TypeScript checking for `electron/main.ts` and `electron/preload.ts`
  passed.
- Renderer build and Electron main/preload/renderer build passed using
  temporary configs with the Sentry plugin removed and `SENTRY_AUTH_TOKEN`
  unset. The CSS test-utility parser warning and renderer large-chunk warning
  remain. The tracked production build configs were not changed.
- Final targeted review traced persisted checkpoint discovery through native
  reconciliation, Activity action registration, claimed retry, persisted
  retirement and reference-checked cleanup; and directory selection through
  job binding, retry, cleanup and owner-token retirement. No unresolved finding
  was identified in the requested scope. This final pass was performed in the
  implementation session; it was not a separate reviewer-agent audit.
- No Windows packaged UI, physical USB/exFAT behavior, public YouTube download,
  or live Mux upload/deletion was exercised. These remain integration checks;
  the local workflow is ready for real-controller testing.

#### Final scoped review details

**Review scope:** Risk-scoped workflow review of the restart recovery and native
directory-binding follow-up, including production owners, call sites, changed
tests, feature contract and release note. Unrelated existing downloader and
linked-video behavior was not re-certified. The review was done in the primary
implementation session, not by a separate reviewer.

##### Findings

- **Critical:** None.
- **High:** None.
- **Medium:** None.
- **Low:** None.

##### Product authorization status

**Authorized.** The supplied request explicitly requires automatic recovery of
persisted relink checkpoints, retry through existing Activity, non-destructive
startup reconciliation, and native binding retirement only after successful
cleanup. The desktop video feature contract now records these outcomes.

##### Open questions and assumptions

No blocking questions. Discovery treats the captured church's PouchDB library
as authoritative and retry reuses the existing claim and cleanup helper. There
is no cross-device transaction between PouchDB and native or provider storage;
the existing checkpoint/retry design handles those split commits.

##### Verification gaps and evidence

| Invariant | Production owner and consumer | Async/persistence boundary and exact evidence | Result |
| --- | --- | --- | --- |
| Restart restores one valid action | `ControllerContextWrapper` → long-lived `DesktopVideoDownloadManager` → `TransferProvider` | Fresh Redux/provider tests cover pending and committed native adoption, ready gating, repeated initialization/replication, route unmount, and Church A → B during held native status; all assertions passed | Pass |
| Retry preserves durable ownership | Captured church/database → `retryLinkedVideoReplacement` → media claim → Pouch/native/Mux cleanup | `relinkLocalVideo.test.ts` covers lost commit acknowledgment, disconnected drives, newer edits, scope switches, conflicting committed rollback, Mux/reference failures, and Activity retirement | Pass |
| Native destination remains retryable | Authorized WebContents → selection token → `start-video-download` → download controller → cleanup IPC | `videoDownloaderIpc.test.ts` covers failed external-save retry, default-folder changes, cleanup failure/success/idempotence, owner destruction, foreign-window rejection, and repeated jobs; `videoDownloader.test.ts` covers actual native job cleanup | Pass |
| Checkpoint authority and persistence reads remain valid | Captured PouchDB v2 library → `loadMediaLibrary` / `readMediaItemForDeletion` | `mediaDocUtils.test.ts` verifies authoritative library load, schema rejection and item reads; manager transition cases above verify the action is not published until the checkpoint is reread | Pass |

Required production context: **Pass** for the scoped source path. The actual
route tree mounts the manager inside `ControllerContextWrapper`, above routes
and alongside `TransferProvider`. Tests use a fresh Redux store/provider and a
held native-status promise for route retirement and church switching. PouchDB
reads and Electron status are mocked in the manager composition test; real
library helpers, native downloader cleanup, IPC authorization and conditional
relink writers have focused tests. No packaged UI is claimed.

##### Coverage ledger

| Workflow / changed path | Production path and downstream consumer | Tests inspected / executed | Skipped area and reason |
| --- | --- | --- | --- |
| Restart discovery / `DesktopVideoDownloadManager.tsx` | Media readiness → captured PouchDB → native relink status → Transfer Activity | `DesktopVideoDownloadManager.test.tsx`; `mediaDocUtils.test.ts`; `useControllerPageLifecycle.test.tsx` | Signed-in packaged UI; not a local build check |
| Durable retry / `relinkLocalVideo.ts`, `mediaCleanupActivity.ts` | Activity action → existing claim → native adoption reconciliation → persisted retirement/reference checks | `relinkLocalVideo.test.ts`; `Media.test.tsx`; `MediaUploadInput.test.tsx`; `mediaCleanupActivity.test.ts`; `transferContext.test.tsx` | Live Mux; requires external service credentials/network |
| Native cleanup / `videoDownloaderIpc.ts` | Preload IPC → authorized sender/job binding → `VideoDownloader.cleanup` | `videoDownloaderIpc.test.ts`; `videoDownloader.test.ts`; `externalVideoFinalization.test.ts` | Physical USB/exFAT destination disconnection |

##### Final readiness

**Ready** for the scoped workflow and real-controller testing. This is not a
packaged-release certification. The UI, public YouTube, live Mux and physical
storage integration checks above remain outstanding.

## Independent code review

Scope: **workflow review** of this request; not certification of every existing
branch change. **Entire change set inspected**, including intentional untracked
tests and verification scripts. The reviewer used the repository code-review
skill and persistence, async, React and display guidance.

### Findings

Critical: None. High: None. Medium: None unresolved. Low: None unresolved.
The final resumed-rollback finding was fixed and independently retested.

### Product authorization status

**Authorized:** relink preservation/recovery, safe Mux retirement, per-job folder
binding, local path UX, menu terminology, atomic publication and measured I/O
changes are requested in the supplied work order. The feature contract records
the resulting behavior. No unresolved product decision remains.

### Open questions / assumptions

None blocking. Existing Pouch per-item revision/conflict semantics remain the
shared mutation model; no distributed cross-device lock or multi-store transaction
was introduced. Arbitrary future remote replication cannot be made atomic with a
local filesystem/provider deletion by this targeted change.

### Verification gaps and evidence gate

| Invariant | Production owner / reader and writer | Adversarial boundary and exact evidence | Result |
| --- | --- | --- | --- |
| Saved references remain valid | Media → native registry → protocol consumers | `localAssetStore.test.ts`: working saved playback ID through staging, failed commit and retry; equal-time stale candidate rejection | Pass |
| Later edits survive rollback | Captured Pouch item → conditional writer → retained recovery | `relinkLocalVideo.test.ts`: route retirement, persisted later thumbnail/width/audio edits, native noncommit and recovery | Pass |
| Recovery survives uncertainty | Durable checkpoint → native status → Activity | Same suite: lost native acknowledgment, disconnected source/candidate drives, cache-boundary claim exclusion, retained action publishes and retires Redux marker | Pass |
| Wrong bytes cannot upload | Local cloud-share captured DB/native hash; download claim | `localMediaCloudShare.lifecycle.test.tsx`: selected A or B / persisted B / native A; `desktopVideoDownloadController.test.ts`: held cloud registration excludes relink | Pass |
| Deleted item stays deleted | Captured library → cloud patch → item writer | `persistDownloadedVideoMedia.test.ts`: deleted local import rejects cloud retry without flush/Redux creation; writer uses noncreation mode for existing baseline | Pass |
| Cleanup preserves references | Strict schema/row reads → existing Mux cleanup API | Relink/persistence tests: shared/legacy/unknown/unreadable references; server tests: church ownership and idempotent absent asset | Pass |
| Destination remains bound | Dialog token → preload → authorized native job | `videoDownloaderIpc.test.ts`: preference changes, retry and unavailable original destination | Pass |
| Final MP4 is complete | Native temporary copy → exclusive publication | `externalVideoFinalization.test.ts`: held incomplete copy, source mutation, real Windows fallback, conflict and registry-failure retry | Pass |
| Outputs reacquire current bytes | Native events → IDB → URL/thumbnail caches → service pool | URL/cache/thumbnail tests: old-revision active leases and two-phase invalidation; service inventory event during load; actual prepared pool refresh | Pass |

Required production context: **Pass** for source entry points and representative
composition. Review traced Media and dialog mounting, Redux/context ownership,
TransferProvider/DesktopVideoDownloadManager lifetime, native authorization and
preload contracts, file protocol consumers and provider ownership checks. Tests
include real Pouch-style conditional writers and real Windows filesystem paths,
not only hook mocks. Package/runtime confidence limits follow below.

### Coverage ledger

| Workflow | Production path and downstream consumer | Inspected / executed evidence | Optional area not exercised |
| --- | --- | --- | --- |
| Relink | Media picker → Chromium metadata → Pouch → native commit → IDB/caches → Activity | Native, import, Media, relink and recovery suites | Packaged signed-in UI |
| Cloud | Shared claims → native/Pouch identity → provider upload/registration → safe retirement | Cloud lifecycle, manager, persistence and server suites | Live Mux |
| Downloads | Dialog → long-lived manager → native job → external save → library | Dialog, IPC, controller, finalization and progress suites | Live public YouTube |
| Playback | Saved item/box ID → protocol → caches → service inventory and prepared pool | Cache, resolver, hooks, pool and DisplayWindow core-path suites | Live multi-window presentation |
| Tools | Benchmark and real FFmpeg smoke scripts → pinned tool resources | Local measurements and native smoke | Real USB/exFAT hardware |

Retirement matrix: download operations remain with the existing long-lived
manager. Relink's persisted checkpoint and captured database support retained
Retry/Dismiss through Activity after route retirement. Pending late cleanup gains
recovery through the same shared helper; route-local UI state is not required.
Scope changes suppress stale publication and require the original church for
destructive continuation.

### Pattern / learning opportunities

Durable rollback requires both previous values and the original proposed mutation
baseline. A fresh authoritative read establishes current state, not ownership by
an older operation. Recovery and ordinary mutation paths must share operation
claims through cache/provider completion. Regression tests now enforce these
specific boundaries without introducing a new policy subsystem.

### Completion checklist

Cross-boundary review: Yes. Sibling-pattern search: Yes. Persisted compatibility:
Yes. Identity-switch tests: Yes. Unmount/lifetime tests: Yes. Contract round trip:
Yes. Validate/use security: Yes. Retry authority: Yes. Owner-retirement handoff:
Yes. External adoption/compensation: Yes. Authorization projections: Yes.
Production entry/runtime/test composition compared: Yes.

## Packaging and optional runtime limits

The local unpacked Windows packaging attempt used the installed Electron runtime,
publishing disabled and a dedicated temporary output directory. It remained in
dependency traversal without producing the application ASAR and was stopped after
several minutes without output progress. No successful package, installer or
packaged UI verification is claimed. The real-video smoke used the pinned
development resources, not an application produced by that incomplete attempt.

Additional confidence not exercised: signed-in packaged UI; live Mux upload and
deletion; public YouTube download; physical USB/exFAT behavior/disconnection;
live projector/monitor/stream windows. Deterministic Windows filesystem and
lifecycle regressions cover these workflows' code boundaries; they do not replace
those hardware/network checks. Existing Pouch replication has no distributed
transaction with native filesystem/provider side effects, as noted above.

The optional Show in folder action is not implemented. No required implementation
follow-up is known. Temporary verification configurations and partial package
output are removed after the final build.

## Final verification and readiness

As of November 12, 2026, the requested source changes pass 14 focused Jest suites
(280 tests), client TypeScript, client lint, strict Electron main/preload
TypeScript, the renderer build, and the Electron main/preload/renderer build.
Builds used temporary Sentry-free configs with the upload token unset; those
configs were removed afterward. Existing CSS parser and renderer chunk-size
warnings remain.

Final targeted review found no unresolved Critical, High, Medium or Low findings
in this request's scope. The review was performed in the implementation session,
not by a separate reviewer. No merge or publication was performed.

**Final readiness: Ready.** The scoped recovery and native cleanup workflow is
ready for real-controller testing. A packaged Windows UI, live YouTube download,
live Mux upload/deletion and physical USB/exFAT behavior were not exercised.
These are integration gaps, not passed checks or a branch-wide release
certification.
