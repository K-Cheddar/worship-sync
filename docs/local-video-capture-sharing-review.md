# Local capture sharing review — October 27, 2026

Scope: workflow review of this capture change on `in-progress`, including its
pool, manager, view, diagnostics and Electron configuration. This is not a
production-readiness review of the whole branch or a USB-hardware certification.
Existing unrelated working-tree changes were excluded from the patch/review.

## Findings

Critical: None remaining. High: None remaining. Medium: None remaining.
Low: None remaining.

The review found and corrected the controller picker/transmit ownership path:
those preflights could otherwise retain the capture Web Lock outside the host.
They now request host warming through existing discovery messages and use the
callers' existing owned-elsewhere handoff. A stale-effect lease release and
no-frame direct join also received explicit lifecycle coverage. A misplaced
cleanup block caught during implementation was fixed and all affected tests
were rerun successfully.

## Product authorization status

Authorized by the October 27 request: direct local Electron playback, host
continuity, audience-quality priority, compatibility relays, bounded attempts,
hidden/inactive preview retirement and diagnostics. No confirmed pre-existing
capture contract was found. Decisions and unchanged boundaries are recorded in
[the implementation and acceptance guide](local-video-capture-sharing.md).

## Open questions / assumptions

No unresolved product decisions. Sharing depends on a consistent device identity
and Windows backend/driver behavior. Ideal constraints do not prove delivered
quality. The observed live-mode-upgrade limitation is documented rather than
reported as a successful upgrade. No measured USB-card performance gain is
claimed from synthetic tests.

## Verification gaps

Production-context verification: Pass for the scoped code/runtime composition.
`App` mounts the manager in the Electron host; the controller wrapper excludes
it in Electron. Fullscreen projector/monitor, direct stream and controller/Aux
preview routes reach the view with existing activity/audio/owner flags. The
same partition, origin and host/output throttling policies were inspected.
The native fixture uses the real pool, Web Locks, quality channel and publishers
in Electron 41.10.7 / Chromium 146.0.7680.216; app providers and UI are covered
by existing composition tests and source tracing, not by synthetic sign-in.

| Invariant | Adversarial sequence | Inspected path / executed evidence | Result |
| --- | --- | --- | --- |
| Host owns continuity | Controller preflight requests capture before output joins | `acquireWarmLocalVideoCapture` delegation; pool delegation test, demand/TTL manager tests; native preflight returns owned-elsewhere | Pass |
| One native device | Host at 4K -> three renderer clients join with 1080p preference | Native fixture: one CreateAndStartDeviceAsync, zero releases during joins, all clients receive 4K; no VideoEncoder/VideoDecoder/MediaRecorder objects | Pass |
| Reload isolation | Projector frames -> controller reload/rejoin -> next projector frame advances | Native fixture, real pool and publisher | Pass |
| Failure isolation | Aux releases -> getUserMedia rejects -> host/projector deliver more frames | Native fixture; view tests separately assert WebCodecs/MSE fallback, preserved audio and no polling | Pass |
| Lease identity | Old same-source attempt pending -> new lease attaches -> old rejects | View stale-failure test compares actual lease IDs and excludes release of new lease; pool retirement test cancels before host readiness | Pass |
| Resource lifetime | Preview hidden/inactive -> lease releases; standalone demand heartbeat -> expiry + grace | View hidden/inactive tests; manager controlled-time expiration/refresh test; pool multi-consumer test | Pass |
| Audience quality | Small preview remains after higher demand leaves | Quality floor test preserves 1080p60 request; native-size fixture preserves existing 4K delivery | Pass |
| Adjacent behavior | Browser/desktop/remote paths, A/B lanes, Aux, volume, relays | Named focused suites in guide, including core display paths and surface/Aux composition | Pass |
| Lightweight diagnostics | Repeated frame callbacks inside one second; direct -> realtime -> MSE | View samples getSettings once/sec; diagnostics test counts both fallbacks | Pass |

Successful final checks: 16 focused Jest suites, 251 tests, using the exact
selection in the guide; `npm.cmd run build:strict --prefix client` (includes
zero-warning ESLint); `npm.cmd run type-check --prefix client`;
`node client/e2e/local-video-sharing.mjs`; scoped `git diff --check`.
The native artifact directory printed by the final native run was
`%TEMP%/worshipsync-capture-sharing-YpAKAf`.

The build completed with existing large-chunk and test-fixture CSS URL warnings
(`controllerProfiles.test.ts` includes a javascript URL sanitization fixture).
Those files were outside this change. No exhaustive client/server suite or CI
run was performed.

Additional hardware acceptance remains unverified: real USB driver/session
sharing, actual 1080p60, CPU/GPU/memory comparison, perceived delay/smoothness and
an extended session. The guide documents the procedure. The fake source's 20 fps
does not validate 60 fps. Full signed-in application operation with the target
capture card remains part of that hardware acceptance.

## Pattern / learning opportunities

Keep the native capture fixture as a focused regression check when Electron or
capture ownership changes. No general repository policy or new media subsystem
is needed. Further optimization should follow hardware measurements.

## Final readiness

Ready for the stated software workflow scope. Hardware acceptance remains a
separate prerequisite for claiming the performance problem solved on the target
Windows computer.

- Cross-boundary review performed: Yes — owner, async discovery, playback, host
  recovery, failure and cleanup were traced.
- Sibling-pattern search performed: Yes — picker, media-library and ItemSlides
  preflights, desktop path, editor, stream, projector/monitor and Aux.
- Legacy/persisted-state compatibility reviewed: Yes — no saved or synchronized
  shapes changed; absent capture kind still means device.
- Identity-switch test reviewed or added: Yes — source replacement and stale
  same-source lease failure.
- Unmount/lifetime test reviewed or added: Yes — pending discovery, active views,
  hidden previews, manager demand expiry and cleanup.
- Contract round trip traced: Yes — binding -> host intent/demand -> pool -> view;
  saved presentation data and remote owner checks remain unchanged.
- Validate/use security boundary reviewed: Yes — host demand requires a local
  saved hardware binding; existing media permission/origin boundary remains.
- Retry-state authority reviewed: Yes — host recovery remains authoritative;
  a failed direct activation stays on relay without device polling.
- Owner-retirement handoff reviewed: Yes — view cleanup retires its lease; late
  results cannot claim a newer lease. The host owns continuity. There is no
  Activity, global cancel/dismiss, or durable job state to retire.
- External side-effect adoption/compensation reviewed: Not applicable — no
  external writes or compensating deletions.
- Authorization/data-projection reviewed: Not applicable — no API permission or
  data-projection changes; the existing local owner-device guard is preserved.
- Production entry point, runtime context, and test composition compared: Yes —
  scope and unavailable hardware/UI validation are described above.
