# Linked-video reliability implementation and review

Worktree: `worship-sync-2`, branch `in-progress-2`, baseline
`94944d8a3b8433868a12eef4e0370b2ee394d8c5`. Recorded November 11, 2026.
No merge to master or publication was performed.

## Root causes and changes

| Confirmed issue | Cause | Change |
| --- | --- | --- |
| Failed relink damaged the previous reference | Native registration changed before renderer validation and library persistence | Stage a separate trusted candidate; validate it; conditionally persist a checkpoint; atomically adopt under the original native asset ID |
| Saved service/slide references could become stale | Saved consumers embed the native asset ID | Retain both library and native IDs; invalidate future URL acquisitions while respecting active leases |
| Interrupted relink had uncertain ownership | Pouch, native registry, IndexedDB and provider cleanup are separate commits | Durable previous/proposed snapshots, native registry-only reconciliation, conditional rollback and retained Activity recovery |
| Resumed rollback could erase later edits | Current values were used as the older operation's comparison baseline | Persist immutable proposed fields and compare against those; preserve later thumbnail, dimension and audio edits |
| Replacement left old Mux storage | Old cloud references were cleared without retirement | Save cleanup IDs with the replacement and reuse reference-checked, church-authorized cleanup |
| Upload could use old native bytes during recovery | Shared replacement metadata could precede native adoption | Require selected, persisted and native content identity agreement before linked upload; serialize overlapping operations with existing claims |
| Cloud-registration retry could recreate a deleted item | Missing-row retry reused the initial-import creation path | Cloud patch requires an existing authoritative row; the item writer also refuses recreation if deletion wins during its write |
| External jobs could follow a changed default folder | Finalization read the mutable device preference | Bind an opaque native directory selection at first start and retain it across retries |
| Fallback exposed incomplete final MP4s | Exclusive copy wrote directly to the final name | Copy to a temporary file, sync it, then publish exclusively and atomically; never overwrite an existing file |
| External finalization reread copied bytes unnecessarily | Temporary copy was separately rehashed | Hash the copy stream while retaining source identity checks, initial hash and final registration verification |

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

Final renderer and Electron main/preload/renderer builds both completed with exit
0 after the proposed-snapshot correction. Local build logs:
`linked-video-renderer-local-build.log` and `linked-video-electron-local-build.log`.
The final client type check, lint, 7-suite/149-test affected-consumer rerun,
independent 21-test relink rerun and real-video smoke also passed. Earlier native
TypeScript, 32-suite/505-test run and 24 server tests remain applicable; no native
or server production code changed after those checks.

Temporary local build/package configurations and incomplete package output were
removed. During verification, HEAD advanced externally to `60363742` (`chore: wip`)
containing the implementation and intermediate report/configurations. That commit
was not rewritten; final report corrections and temporary-config deletions remain
as working-tree changes.

**Final readiness: Ready** for the requested workflow implementation/review scope.
No unresolved required implementation or verification remains. Packaging and the
listed hardware/network/UI checks are additional-confidence gaps, not successful
checks or a branch-wide production-readiness certification.
