# Production correctness: countdown configuration and song audio

Branch: `in-progress`. Reviewed HEAD: `563bfa9756e6d586aef33c5a0e9df68b4ceaa6c6`.

## Goal

Align paired service countdowns with the controller and prevent an audio operation from defeating cross-controller song conflict detection. Preserve both guarantees through future merges.

## Existing architecture

`App` mounts Redux, `GlobalInfoProvider`, and `ChurchServiceTimeZoneProvider` outside the route tree. Pairing/bootstrap supplies a church, session kind, display identity/output and stored credential. Shared-data authentication explicitly sends the display token; ordinary API requests automatically send human/workstation credentials but not display credentials. Projector and monitor reach `TimerDisplay` through `FullscreenPresentation`/`DisplayWindow`; stream reaches it through `DisplayWindow`. `useAvailableServiceTimes` uses initialized controller Redux data or a church-scoped Firebase services listener on displays. GlobalInfo independently subscribes to Firebase server-time offset; occurrence resolution and countdown text use that synchronized clock.

Songs have a persisted Pouch document, editor draft, comparison baseline, pending remote document, and pending/versioned store autosave. `persistSongAudioAttachment` already reads fresh state from the supplied concrete database and changes audio only, with revision conflict protection. `SlideEditor` owns upload/removal and dispatches the persisted result. Explicit conflict actions live in the editor; the listener performs field comparisons and writes.

## Before behavior

- Display sessions could not load church timezone configuration. The provider excluded them, the API omitted their token, the endpoint rejected their session, and the occurrence hook silently chose UTC. A 10:00 New York service resolved four or five hours early.
- Audio completion accepted the remote document as the entire comparison baseline. A local lyric draft could then look like an ordinary edit against B's already accepted lyrics, allowing autosave to overwrite B without Keep Editing Mine. Pending audio could also be restored by a late older save acknowledgment; Use Their Changes did not retire all queued work.

## After behavior

- The narrow timezone GET explicitly sends the display credential, resolves current server credentials and enforces church ownership. It returns presentation configuration only to displays/default workstations; existing richer authorized human/booth behavior remains. Refresh occurs every minute and on online/realtime reconnect. Session/device/church changes invalidate cached scope. Errors or missing configuration yield no countdown target, using the existing placeholder; no implicit UTC. Occurrences derive synchronously from the current configuration, avoiding a stale target after a configuration change.
- Audio completion patches only audio and saved metadata in the baseline, retains pending local and remote content, and carries the original mutation owner. Queued/superseded work is checked before reads and writes; Use Their Changes retires pending local work. An older acknowledgment cannot replace newer editor state; partial acknowledgment advances only fields actually written.

## Product Decision Check

Authorized by the October 14 request. The registry previously had only inventory entries for these workflows, so focused confirmed contracts now record the request: [service countdowns](../features/service-countdowns.md), [song conflicts](../features/song-audio-conflicts.md). No unresolved product choice. Configuration polling and reuse of the existing placeholder are local implementation choices implementing the requested recovery/failure behavior.

## Behavior intentionally unchanged

Service recurrence and grace rules, explicit configured UTC support, server-time synchronization, stream transparency, display read-only presentation capabilities, human permission axes, default workstation saved-plan reads, booth workspace access, audio storage cleanup ordering, and unrelated song data remain unchanged. No branch merge, deployment, or automatic SMS configuration change.

## Acceptance criteria and proposed implementation

Use the existing provider, endpoint, token resolver, occurrence utility, field-aware autosave, and mutation-owner model. Do not introduce another configuration store, permission role, or mutation subsystem. Verify non-default zone/DST, missing configuration, token revocation, cross-church denial, reconnect, configuration changes, both audio operations, explicit conflict choices, scope retirement, and late acknowledgments.

The patch exceeds the repository's small-change warning threshold because these are two production boundary defects plus their regression tests. Most additions are controlled tests and documentation. Sibling review also found that the standalone drawer included its cached name in an audio-only patch; it now omits that name and checks database/church/lifetime before publication. New runtime complexity is limited to periodic configuration revalidation, scope checks, and guards on the existing autosave lifecycle. Derived occurrence state was removed instead of adding another cached target.

## Affected surfaces and risks

Controller, default/booth workstation, paired monitor, browser/Electron projector, stream, song editor, Redux listener/undo boundary, Pouch revisions, HTTP auth, Firebase service reads, and synchronized clock. There is no changed renderer/media/IPC/RTDB protocol or new SMS action. Tests use faithful provider/session/data composition and actual HTTP client code, with Firebase transport and HTTP responses controlled; server tests use actual pairing/redeem/bootstrap/handlers against the in-memory auth store. Physical paired hardware and deployed Firebase rules are additional confidence checks; these changes do not modify those rules.

Settings/revocation become visible on the next revalidation (normally within 60 seconds while active; browser suspension can delay timers), or immediately on reconnect/session change. Server authorization rechecks the credential on every request. There is no push invalidation protocol. Existing offline configuration caching is retained, but a known configuration error suppresses countdowns.

## Questions requiring user input

None.

## Why review missed these findings

The historical reviewer thought process is not available; the following are demonstrated coverage gaps, not claims about intent.

1. **Countdown:** the hook tests supplied a ready UTC provider, while provider tests used a human session. Neither composition established that a paired session could fetch a non-UTC church setting through the real client and server boundary. The API/server gap was masked by the fallback. Code-review workflow step 9 (production composition), authorization/data projection, and the display surface pass should have caught it. Future evidence must enumerate session/surface consumers, show credential transport and negative server authorization assertions, and exercise non-default DST/standard-time targets using the real provider and renderer.
2. **Audio:** the former audio autosave test supplied a returned document whose name already matched the local edit and asserted no database read. It had no competing controller/revision and could pass while the baseline was replaced. It therefore proved debounce cancellation, not conflict preservation. The persistence/publication cross-boundary pass and adversarial acknowledgment/concurrency lenses should have tracked baseline, local intent, remote conflict, revision, and persisted result through audio and autosave. Future evidence must control the original competing-write order, assert B's persisted lyrics survive, and exercise both explicit decisions plus late acknowledgments and owner retirement.
The countdown merge comparison also shows that parent 1 had no church timezone provider (the hook used the prior occurrence path), while parent 2 introduced the human/workstation-only provider and UTC fallback; the merge retained that new composition without paired-session coverage.

3. **Merge:** `6054b0a48f289c6475d3eaa3b7372c831201f8f8` has parents `451e6fba7c0515465f36efbe93df910a691e6fb2` and `4d51928064b7fbdb22820cefa0fac4b2222bb33f`. At `applyPersistedSongAudio`, parent 1 replaces the whole baseline, parent 2 patches audio/revision metadata, and the merge restores parent 1's defect. The previous review process did not require evidence comparing both parents' critical behavior with the merge result. A merge-base diff or green CI cannot establish retention of the known fix. The existing skill now requires parent/result SHAs, symbols, known-fix retention and failure-derived tests in its existing Verification gaps section. No parallel checklist was created.

## Independent final review

Scope: fix verification and affected workflow review; a separate second pass from implementation traced the complete fix, callers, analogous mutation paths, permissions, lifecycle transitions, and tests. This is not an independent human or second-agent review. Separate startup/transparency edits appeared in the shared working tree during the task; they were preserved and are outside this fix's review scope.

Product authorization: Authorized, current request and focused contracts. Findings: Critical none; High none; Medium none; Low none in the fix scope after the second pass and resulting corrections. Open questions: none.

| Invariant | Adversarial scenario | Code evidence | Test evidence | Result |
| --- | --- | --- | --- | --- |
| Same absolute service target | Human/workstation and paired monitor/projector/stream, New York weekly 10:00 in July and January, device clock 30 seconds slow | App/provider/auth client, services listener, resolver, TimerDisplay, server offset subscription | `pairedDisplayCountdown.integration.test.tsx`: actual provider/client/listener/renderer, 14:00Z summer and 15:00Z winter | Pass |
| Least privilege | Real paired credential reads own zone, another church, management routes, updated setting, revoked credential | Existing resolver, church check, timezone-only response; management guards unchanged | `teamsApi.test.js`: real pairing/redeem/bootstrap and negative assertions | Pass |
| B's lyrics protected | A edits lyrics, B saves different lyrics, deferred attach/remove writes only audio, A autosaves, then explicitly keeps local edits | Reducer preserves lyric baseline/pending conflict; autosave fresh field comparisons | `store.test.ts`: controlled revisions and deferred audio gate; B survives until Keep Editing Mine | Pass |
| Explicit remote adoption | Autosave read pending, remote document buffered, Use Their Changes, old read settles | Pending map/debounce retirement and post-read version check | `store.test.ts`: remote content/audio retained and no stale put | Pass |
| Audio not resurrected by acknowledgment | Autosave commits, response delayed, audio persists, older response settles | Version-aware acknowledgment; partial baseline advancement | `store.test.ts`: editor, persisted document and baseline all retain new audio | Pass |
| Standalone audio preserves unrelated data | Drawer has an old song name, database has a newer rename and lyrics; attach/remove only audio | Optional-name patch omits the cached name for audio, fresh revision write | `ViewSongSectionsDrawer.test.tsx`: both audio operations preserve remote name and lyrics; deferred upload after unmount updates only original DB | Pass |
| Owner retirement | Upload held while song changes, church/database changes with same song ID, or editor unmounts | Captured database/mutation owner; scoped dispatch/publication guards | `SlideEditor.test.tsx`: deferred upload through actual Song details/Choose MP3 UI; original DB only; `itemSlice.test.ts`: stale owners rejected | Pass |

Cross-boundary review, sibling-pattern search, legacy/persisted compatibility, identity-switch tests, unmount tests, contract round trip, security validate/use, retry authority, owner retirement, external result adoption/compensation, authorization projection, and production/test composition comparison: Yes. Audio cleanup retains original church ownership and preserves adopted results; failure ordering is also covered by the existing persistence utility suite. No additional review checklist is added to the skill.

## Verification

The new failure-derived tests were run with the reviewed HEAD versions of provider, hook, API client, reducer, and handler temporarily restored, with source bytes restored in a `finally` block. Both audio conflict cases and all three display integration cases failed (5 client failures); the paired-display server case failed with authentication denial. The fixed versions subsequently passed. No branch switch or merge occurred.

Executed checks:

- Broad client regression run: **48 suites, 633 tests passed**. This covered all DisplayWindow test files, timezone/provider and occurrence logic, service timer consumers, Redux item/service state, song editor and persistence, API auth, and timezone settings/gates. The exact invocation was:

```powershell
npm.cmd test --prefix client -- --runInBand src/context/churchServiceTimeZone.test.tsx src/context/pairedDisplayCountdown.integration.test.tsx src/hooks/useDisplayedUpcomingService.test.ts src/hooks/useNextServiceCountdownText.test.ts src/store/store.test.ts src/store/itemSlice.test.ts src/store/serviceTimesSlice.test.ts src/utils/serviceTimes.test.ts src/utils/serverTime.test.ts src/utils/persistSongAudioAttachment.test.ts src/utils/ownedItemContentMutation.test.ts src/containers/ItemEditor/__tests__/SlideEditor.test.tsx src/api/__tests__/auth.test.ts src/components/DisplayWindow/__tests__ src/pages/Teams/ChurchServiceTimeZoneSettings.test.tsx src/pages/Teams/components/ChurchServiceTimeZoneGate.test.tsx src/containers/ServiceTimes src/containers/Timers/Timers.test.tsx src/containers/ServiceItems/ServiceItems.test.tsx src/pages/StreamInfo.test.tsx
```

- Final focused run after the acknowledgment/publication corrections and expanded conflict decisions: **5 suites, 190 tests passed**:

```powershell
npm.cmd test --prefix client -- --runInBand src/store/store.test.ts src/store/itemSlice.test.ts src/containers/ItemEditor/__tests__/SlideEditor.test.tsx src/context/pairedDisplayCountdown.integration.test.tsx src/context/churchServiceTimeZone.test.tsx
```

- Final countdown memo/display verification: **4 suites, 95 tests passed**:

```powershell
npm.cmd test --prefix client -- --runInBand src/hooks/useDisplayedUpcomingService.test.ts src/context/pairedDisplayCountdown.integration.test.tsx src/components/DisplayWindow/__tests__/DisplayWindowTimersAndText.test.tsx src/components/DisplayWindow/__tests__/DisplayWindow.corePaths.test.tsx
```

- Final server regression: **437 passed, 1 skipped, 0 failed** (438 tests total). The skipped pre-existing human custom-token minting check requires Firebase Admin credentials; pairing credentials, ownership, revocation, and permission checks ran successfully without a live backend:

```powershell
node --import tsx --test server/teamsApi.test.js server/appSessionGuards.test.js server/sharedDataAuthClaims.test.js server/humanApiBearerAuth.test.js server/authSessionRecovery.test.js server/authLifecycleGuards.test.js server/authLifecycleHappyPath.test.js server/authDevicePairingBroker.test.js server/songAudioStorage.test.js server/songAudioUploadGuard.test.js
```

- Standalone drawer sibling and editor regression: **2 suites, 61 tests passed**:

```powershell
npm.cmd test --prefix client -- --runInBand src/components/SongSections/ViewSongSectionsDrawer.test.tsx src/containers/ItemEditor/__tests__/SlideEditor.test.tsx
```

- `npm.cmd run type-check --prefix client`: passed.
- `npm.cmd run build:strict --prefix client`: **passed, native exit 0**, including final standalone drawer changes. This includes the required zero-warning `lint:check` gate. The sandbox denied esbuild's parent-directory access; the build was rerun with approved filesystem access. Lint errors were corrected; the narrow clock memo dependency suppression documents the required external-clock/boundary invalidation invariant.
- `git diff --check`: passed.
- Latest available [GitHub Checks](https://github.com/K-Cheddar/worship-sync/actions/runs/38585515812): **success** for reviewed HEAD `563bfa9756e6d586aef33c5a0e9df68b4ceaa6c6`. No CI run exists for these uncommitted changes. CI success is not the basis for the implementation conclusion.

No full repository client/server suite, physical paired-device smoke test, or live Firebase credential/rules check was performed. Required production composition and security behavior were checked with the faithful client composition and real server auth/pairing handlers described above. Separate concurrent startup/transparency edits are preserved and excluded from this fix review; release review must cover those edits separately.

- Final controlled-revision fixture verification: `npm.cmd test --prefix client -- --runInBand src/store/store.test.ts`: **108 passed**, native exit 0. Fixture revisions advance from each document's actual current revision, including remote commits.
- Final standalone `npm.cmd run lint:check --prefix client`: passed with zero warnings/errors. The production bundle retains Vite's existing nonfatal large-chunk advisory.

Implementation status: **COMPLETE** for this requested fix set. Final readiness: **Ready** for fix verification and the affected workflows. Recommendation: **GO for these fixes**. There are no known required follow-ups or remaining findings in this fix set. This is not approval of the separate concurrent startup/transparency edits or an instruction to deploy the combined working tree; those changes require their own review. The operational refresh interval and optional physical/live-backend checks above remain release considerations. No branch was merged, no deployment was performed, and automatic SMS sending was not enabled.
