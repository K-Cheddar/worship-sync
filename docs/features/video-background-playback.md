# Video background playback

## Goal

Operators can choose whether each slide's file-video background loops, independently of its Continue / Start over send behavior.

## Product Decision Check

Confirmed product intent: the October 30, 2026 request for configurable video background looping on `in-progress` authorizes the defaults, slide-level overrides, final-frame retention, replay, and uninterrupted live updates below. No earlier confirmed contract covered these choices.

| Decision | Confirmed behavior | Authorization |
| --- | --- | --- |
| Missing preference | Songs loop; custom (`free`) items play once; other item types retain looping. Explicit true/false wins. No migration. | Current request, requirements 2–3 |
| Persistence | Save `videoBackgroundLoop` alongside the slide's send mode, in the selected arrangement and flat slide deck. | Current request, requirements 3–4 |
| Completion | Retain the final frame. Continue preserves completion; Restart, Play, or Start over can explicitly replay. | Current request, requirements 5–6 and transport tests |
| Live update | Preserve position and pause state when changing Loop. Enabling Loop on a completed clip retains its final frame until replay. | Current request, requirement 7: no automatic restart or interrupted image |
| UI | Loop and Continue / Start over are available in Edit and Present modes, with wrapping compact controls on mobile. | Current request, requirements 1 and 8 |

The same-day UI follow-up uses the shared `Toggle` used by live controls, with a loop icon and the default cyan color used by Show On toggles.

UI follow-up verification: Toggle, VideoBackgroundControls, and ItemSlides suites passed (67 tests); strict client build passed with the existing Vite warnings.

The smooth-progress follow-up is authorized by the same-day request to make the video bar move smoothly. Before: the bar jumps at each measured preview sample or 250 ms live clock tick. After: its fill and thumb interpolate linearly for 250 ms between ordinary forward samples. Pause, completion, explicit seeks, Restart, loop wraparound, and media changes snap immediately. Only this video timeline opts in; playback, reports, synchronization, and the existing React update frequency remain unchanged. Animation state is local to the controls. Keyboard seek release also exits scrubbing even if Radix delivers its value callback after commit. Acceptance checks cover preview/live progression, small keyboard and remote seeks, restart, pause, wrap, completion, no publication from animation, and timer cleanup. No consequential choices require clarification.

Smooth-progress verification passed: VideoBackgroundControls and ItemSlides suites (68 tests), strict client build, and `git diff --check`. A local headless Chromium probe against the built stylesheet and installed Radix thumb-wrapper structure confirmed both the thumb and fill interpolate during the 250 ms interval, reach their target, and snap with zero transition duration when smoothing is disabled. It was a CSS geometry check, not a live-service or hardware playback test. Review found no unresolved findings: animation introduces no persistent/shared state, media identity changes, additional playback timers, or new async ownership boundaries. Readiness for this follow-up: Ready.

## Existing architecture

`ItemSlides` builds timestamped playback cues. `itemSlice` updates slide preferences through the existing item autosave path. The selected editor follows its matching live output cue or local preview commands. `DisplayWindow` routes video through the transition lanes, underlay, or Electron prepared surfaces. File media identity remains separate from playback preferences.

## Before behavior

File videos always looped. Position/drift calculations always wrapped. Browser ended handlers restarted playback, and paused-player recovery could also restart a naturally completed video. Electron activation required motion even when a late output needed a completed final frame.

## After behavior

New sends carry the effective loop value. Running loops retain wraparound synchronization; non-looping playback clamps at duration. Browser native/HLS and Electron playback retain completion without recovery, reloading, or poster fallback. Late joins paint the final frame. Explicit transport can seek, pause, resume, and replay afterward. Live loop changes rebase the cue with the old policy and preserve the media element and READY state.

## Behavior intentionally unchanged

Continue / Start over remain separate from looping. Preparation, source caching, HLS fallback, media identities, surface budgets, transitions, and same-video reuse retain their existing architecture. Monitor backgrounds remain opt-in. Stream keeps its transparent, text/overlay composition; it receives playback cues without gaining slide backgrounds. Local capture and unrelated media-library mutations are unchanged.

## Acceptance criteria

- Missing and explicit preferences resolve correctly, save, restore, and remain independent of send mode.
- Completion retains a visible final frame and never triggers automatic replay or stall correction.
- Late joins and transport commands work after completion, including Restart during a pending terminal seek.
- Different slides may reuse one video with different preferences; live/editor cue selection remains scoped to the relevant outputs.
- Loop changes do not remount media, reload sources, reset readiness, or start a transition.

## Proposed implementation

Extend the existing slide and cue shapes with an optional boolean. Resolve defaults at send/editor boundaries. Share selected-slide mutation logic for both preferences, and share position/completion calculations across players. Pass the preview preference through existing lanes and Electron views without including it in media identity.

## Affected surfaces

Presentation Controller Edit/Present (`ItemSlides`, `SlideEditor`), media-library direct send, Projector and projector-full through `FullscreenPresentation`, content-only/full Monitor, Stream state synchronization, and Electron editor/output prepared surfaces. Existing Redux/PouchDB autosave and Firebase/local-window publication remain the authoritative boundaries. No server API, authentication, permission, or schema migration changes.

## Risks / edge cases

Non-looping end must remain distinct from failed playback. A loop change after several wraps must use the existing playhead, not elapsed time under the new policy. A stale activation must not pause a newer replay. Two outputs using the same media on different slides must not exchange their loop policy. The implementation adds player-specific terminal guards because browser/HLS recovery and Electron preparation have different lifecycles; it does not add a second playback system.

## Questions requiring user input

None.

## Verification

Focused tests cover defaults, explicit/legacy slides, actual autosave after item navigation, restoration, mode independence, clamped clocks/drift, native/HLS completion, prepared-surface completion/late joins, transport/replay, READY/active loop changes, same-video slide transitions, editor/output isolation, and transport-only remote updates without newer slide timestamps. Existing Display Window regressions cover transparency, current/previous composition, overlays, images, text/timers, media transitions, and interrupted ownership.

Required checks passed: the Display Window regression directory; Electron surface pool and utility suites; controls, playback utility, ItemSlides, Media, item/presentation/store suites (35 suites, 815 tests). The two test files adjusted for lint passed again (103 tests). The actual `ItemEditor/__tests__/SlideEditor.test.tsx` and `FullscreenPresentation.test.tsx` suites passed (58 tests). `npm.cmd run build:strict --prefix client` passed after rerunning outside the Windows sandbox; it emitted the existing CSS URL and large-chunk warnings. `git diff --check` passed.

ProjectorFull, Monitor, Stream, SurfacePresentationPreviews, and PresentationPreview suites also passed (39 tests). Total distinct verification: 42 suites, 912 tests.

Additional confidence, not performed: physical projector/monitor, real GPU/HLS decoding, paired remote hardware, and mobile device visual inspection. Automated media tests control metadata, play promises, frame callbacks, seeks, and completion; they do not measure actual hardware frames.

## Review record — October 30, 2026

### Findings

Critical / High / Medium / Low: no unresolved findings. Review corrected early pre-metadata playback, stale same-media cue selection across different slides, active Electron seek/replay handling, and replay superseding a pending terminal activation.

### Product authorization status

Authorized by the current request, as mapped in Product Decision Check. Implementation observations are not treated as independent product authorization.

### Open questions / assumptions

Existing Stream background exclusion and opt-in Monitor backgrounds remain in force. Legacy cues without a loop value retain compatibility; new sends resolve missing slide preferences by item type.

### Verification gaps

Workflow review of this change set, excluding the pre-existing unrelated media-folder/transfer changes. Production entry points and test composition compared: Pass. Entire looping change set inspected; tests inspected and executed are recorded with the final check results in the implementation handoff.

| Invariant | Production owner / consumer / boundary | Adversarial sequence and exact test evidence | Result |
| --- | --- | --- | --- |
| Preference survives navigation | item slice → existing scoped autosave → Pouch item → editor | `store.test.ts`: change loop and mode on A → select B during debounce → save A → restore A; B remains unchanged | Pass |
| Terminal visual stays owned | HLS/native player and Electron prepared surface | Player tests: end → advance recovery timers → assert no play/seek/reload; late join → final frame; pool test: pending end seek → Restart → old seek settles | Pass |
| Latest live preference reaches every replica | controls → presentation cue generation → existing remote store listener → outputs/editor | `store.test.ts`: loop-only update at unchanged slide timestamp on each output → stale cue; `presentationSlice.test.ts`: bridge round trip and editor resolution | Pass |
| Reuse does not exchange policy | transition lanes / selected editor / scoped controls | Same-video consecutive slides with different loop values; different live slides sharing a media key; READY/active toggles retain video/source/load count | Pass |

Cross-boundary review, sibling-pattern search, legacy compatibility, navigation identity, player cleanup/lifetime tests, contract round trip, and production composition comparison: performed. Database retry/owner retirement and external side-effect handling are unchanged existing mechanisms; no new asynchronous persistence owner or external side effect was introduced. Security projection/validate-use changes: not applicable.

### Pattern / learning opportunities

Keep completion distinct from failure in the shared playback utilities; keep loop policy out of preparation and media identities. No new repository-wide enforcement is needed.

### Final readiness

Ready. Scope: affected playback workflow, not a release-wide production-readiness review.
