# Local Electron capture sharing

## Goal

Display local capture cards with direct MediaStream playback in Electron when
Chromium can share the device, keeping the hidden host alive and preserving
the existing relays for incompatible devices. Authorization: the October 27,
2026 request to optimize local video capture using Chromium-native sharing.

## Existing architecture

`main.ts` creates the hidden `/local-video-capture-host` window independently
of controller navigation. `App.tsx` mounts `LocalVideoCaptureManager` there;
`ControllerContextWrapper` mounts that manager in browsers only. Output-slot
and list warm intents drive the manager. The pool deduplicates complete
video/audio bindings in each renderer and elects an exclusive publisher with
Web Locks. Publishers start VP8, MediaRecorder and still-frame work on demand.
The existing direct Electron desktop-share path is the closest analogue.

Link/transmit preflights also previously acquired controller-owned publisher
leases. Those could keep the Web Lock in the controller instead of the host.

## Before behavior

Camera audience windows subscribed to WebCodecs or MSE. Editor/controller
windows could attempt capture, but the host's exclusive Web Lock blocked them.
Preview-only quality demand could eventually reduce the host to 720p30.

## After behavior

Local Electron camera views wait up to three seconds for the existing quality
publisher to announce readiness, then join via getUserMedia without taking the
owner's Web Lock. Each renderer still pools capture. Successful clients paint
srcObject and do not subscribe to VP8, MSE or still frames. Joined tracks request
`resizeMode: { exact: "none" }` so their 1080p preference does not scale down a
host already delivering larger frames. If that constraint is unsupported, the
existing relay remains the compatibility path.

Electron picker/transmit publisher requests now discover/warm the host and
return the existing "owned elsewhere" handoff result accepted by those callers;
they do not create a controller capture or publisher. The manager listens to
existing discovery/quality demand for locally bound hardware, so media-library
previews and newly linked sources can warm before appearing on an output/list.
Standalone demand expires after ten seconds without a heartbeat, followed by
the existing five-second release grace. Live output/list intents still keep
their captures warm independently. Desktop preflights retain their old path.

The host still acquires first, requests 1920x1080 at 60 fps with ideal
constraints, and maintains an audience-quality floor for hardware capture.
Ideal constraints are requests, not evidence of negotiated resolution or fps.
The host continues aggregating higher output demands with the existing quality
relay. Live upgrades are best effort: testing showed that an ideal larger mode
can remain at the existing mode while other Chromium clients are attached.
Do not equate a successful applyConstraints call with an actual device upgrade.

A failed direct join, required-audio join failure, ended video track, or stream
with no initial usable frame after five seconds falls back to WebCodecs, then
MSE if needed. It stays on relay until reactivation/source change; it does not
poll the USB device. The pre-existing host recovery and release grace remain.
Inactive or document-hidden Electron camera previews release their leases.
Audience windows keep running when the document is hidden.

## Product Decision Check

There was no confirmed capture-specific contract in `docs/features/`; the
general live-presentation workflow is inventory only. The current request
explicitly authorizes direct local Electron playback, host continuity,
audience-quality priority, compatibility fallback and preview cleanup. It also
requires existing audio, desktop-share and remote-device behavior to remain.
There are no unresolved product choices. The three-second discovery bound and
five-second first-frame bound are local implementation choices.

## Behavior intentionally unchanged

Browser ownership locks and relay policy; remote owner-device checks; saved
bindings and synchronized presentation shapes; desktop sharing; output mute
and volume; current/previous slide lifetimes; stream transparency; host crash
recovery; audio warning behavior outside the new direct-join path. No new IPC,
transport, codec, native library, or physical-device owner was introduced.

## Acceptance criteria

- Local Electron projector, monitor, stream, controller and Aux views prefer
  direct playback after host readiness, preserving one host owner.
- Consumers reuse per-renderer capture and retire without stopping other leases.
- Failed joins cannot reset the host; fallback is bounded and does not loop.
- Successful direct clients create no application video encoders or decoders.
- Previews do not lower the host's audience mode; diagnostics report actual
  mode separately from requested mode.
- Screen sharing, remote outputs, audio controls and stream transparency retain
  their established behavior.

## Proposed implementation

Extend pool acquisition with an explicit shared-consumer option, gated again by
Electron and hardware kind. Publishers keep the exclusive lock even if that
option is supplied. Reuse the quality channel for readiness discovery and
quality demand; reuse the existing view's direct attach and relay effects.
Per-effect lease generations prevent a late old failure from retiring a newer
lease for the same source. Only hardware host publishers opt into the quality
floor; desktop and browser publishers retain their old policy.

The production change is larger than a lock bypass because it also needs host
ordering, failure/no-frame retirement, native-size playback, quality protection
and lightweight diagnostics. These extend existing components rather than
introducing a new capture subsystem. The manager's reconciliation/recovery code
is reused for both output/list intents and expiring standalone demand.

## Affected surfaces

`ProjectorFull` and `Monitor` use `FullscreenPresentation`; `Stream` renders
`DisplayWindow` directly. Controller and Aux tiles use `PresentationPreview`;
the editor and A/B lanes also reach `LocalVideoInputView`. Their existing
`canCaptureLocalVideo`/active flags gate work. The Electron host, controller,
outputs and same-app children use the same `persist:worshipsync` partition and
origin, preserving device identity. Host and audience windows are unthrottled.
Providers/authentication, Redux output ownership and binding resolution are
unchanged. Utility/native fixtures deliberately omit signed-in app providers;
manager and display tests cover those existing composition boundaries.

## Risks / edge cases

Chromium sharing is conditional on device identity and capture backend/driver.
Success on a fake camera does not prove USB-driver behavior or a CPU/GPU gain.
A slow-to-start host can miss discovery and leave that activation on relay.
Audio-access failure with sound requested falls back to preserve output sound.
Cleanup must handle source changes and unmount while discovery/acquisition is
pending; only the retiring consumer's lease is released. Fixed-mode cards keep
their negotiated mode even if it falls short of an ideal request.

## Questions requiring user input

None for implementation. Hardware acceptance requires access to the target
Windows computer and capture card.

## Chromium applicability

The installed Electron is 41.10.7, using Chromium 146.0.7680.216, as confirmed
by the native fixture and the [Electron release record](https://releases.electronjs.org/release/v41.10.7).
The package range starts at Electron 41.2.0, which uses Chromium
146.0.7680.179 ([release record](https://releases.electronjs.org/release/v41.2.0)).
Both source versions were inspected. `GetOrCreateController` looks up an existing
controller by media type and device ID; `ConnectClient` starts the device only
for the first client; `OnFrameReadyInBuffer` distributes frame buffers to active
clients. These are application-session reuse paths, not multiple independent
Windows device opens. Sources:
[manager](https://raw.githubusercontent.com/chromium/chromium/146.0.7680.216/content/browser/renderer_host/media/video_capture_manager.cc),
[controller](https://raw.githubusercontent.com/chromium/chromium/146.0.7680.216/content/browser/renderer_host/media/video_capture_controller.cc).

## Verification

Run from the repository root:

```powershell
npm.cmd test --prefix client -- --runInBand src/utils/localVideoCapturePool.test.ts src/utils/localVideoCaptureQualityRelay.test.ts src/utils/localVideoDiagnostics.test.ts src/components/DisplayWindow/__tests__/LocalVideoInputView.test.tsx src/utils/desktopCapture.test.ts src/utils/localVideoQuality.test.ts src/utils/localVideoRealtimeRelay.test.ts src/utils/localVideoMediaRelay.test.ts src/utils/localVideoPreviewRelay.test.ts src/components/LocalVideoCaptureManager/LocalVideoCaptureManager.test.tsx src/components/DisplayWindow/__tests__/DisplayWindow.corePaths.test.tsx electron/windowHelpers.test.ts src/containers/TransmitHandler/SurfacePresentationPreviews.test.tsx src/containers/TransmitHandler/AuxControllerPreviewMedia.test.tsx src/components/LocalVideoInputPicker/LocalVideoInputPicker.test.tsx src/utils/localVideoMediaLibrary.test.ts --silent
npm.cmd run build:strict --prefix client
npm.cmd run type-check --prefix client
node client/e2e/local-video-sharing.mjs
```

The native fixture uses real Electron with a temporary isolated profile, four
hidden same-origin windows and a fake camera. It runs the real capture pool,
readiness channel, locks and publishers. It forces the fake host to 3840x2160
to check native-size joins above the client preference, asserts zero
VideoEncoder/VideoDecoder/MediaRecorder constructions, and traces one
`VideoCaptureController::CreateAndStartDeviceAsync` with no device release
during joins. It then stops tracing, reloads the controller and checks continued
projector frames, followed by a forced failed Aux join and continued host frames.
Artifacts (including trace and actual settings) are printed under the system
temporary directory. The fake source delivers 20 fps; this is not a 60 fps
hardware test. The fixture does not exercise full application sign-in/UI.

### Manual Windows capture-card acceptance

1. Use the same Windows computer, USB port, capture card, input signal, resolution,
   display layout and WorshipSync data for the previous implementation and this
   branch. Close OBS while measuring WorshipSync. Record versions, driver and
   input mode. Use moving video with a visible frame counter or clock.
2. In renderer DevTools set
   `localStorage.setItem("worshipsync_local_video_debug", "true")`, then reload.
   Set it before the hidden host starts if host-side capture diagnostics are
   needed. Open projector, monitor, stream and controller/Aux previews. Confirm
   each local client reports `DIRECT`, with no realtime subscribers or submitted
   encoder frames once startup settles. A fallback client reports
   `REALTIME_WEBCODECS` or `BUFFERED_MSE` with its reason and occurrence count.
3. Verify one underlying device session rather than counting getUserMedia calls
   or camera LEDs. On a development run, use Electron `contentTracing` (pattern in
   `local-video-sharing-main.cjs`) with
   `disabled-by-default-video_and_image_capture`, starting before host acquisition
   and stopping after clients join. Count exactly one
   `VideoCaptureController::CreateAndStartDeviceAsync` for this card and no
   `ReleaseDeviceAsync` during joins. For multiple cards, identify controllers
   separately. Use a driver/Windows capture trace as additional evidence if the
   backend does not expose sufficient Chromium events.
4. Inspect host capture settings and each direct consumer's `captureSettings`,
   `paintedFps`, `presentedFrames`, `totalVideoFrames` and `droppedVideoFrames`
   where supported. Confirm the actual mode is preferably 1080p60, within the
   card/signal's capabilities. Confirm preview-only use never requests a lower
   host mode. `activeConsumers` counts quality subscriptions (with heartbeat
   expiry); `activeViewsInWindow` is local. `subscribers` counts realtime relay
   clients. Host `sourceFps` is a relay measurement and can be zero when no
   realtime encoder loop is needed; use direct consumer frame rates then.
5. Compare Windows Task Manager CPU, GPU engines, working set and Electron process
   metrics over equivalent moving-video intervals. Record idle and all-views
   totals; do not claim an improvement from one instant reading.
6. Compare projector and preview motion, dropped frames and the clock/frame
   counter delay. Watch for steadily increasing delay. Confirm each output's
   mute and volume, stream transparency, and screen/window sharing.
7. Reload and navigate the controller while the projector remains on capture.
   Collapse/suspend preview tiles and minimize the controller; projector motion
   must continue. Reopen previews and switch camera -> text -> same camera,
   between two sources, and through current/previous fades repeatedly.
8. Force a direct failure only in a consumer window: save the original
   `navigator.mediaDevices.getUserMedia`, replace it with a function rejecting a
   `DOMException("test", "NotReadableError")`, then reactivate the capture slide.
   Confirm one join attempt, continued host/projector playback, working relay
   fallback and preserved sound/volume. Restore the method (or reload) afterward.
   Repeat with realtime support unavailable to exercise MSE compatibility.
9. Run moving video for at least an hour, periodically switching sources and
   opening/closing previews. Compare memory/handle/GPU usage after each cycle;
   there should be no sustained growth, device reopen loop, or increasing lag.
   Disable diagnostics afterward with
   `localStorage.removeItem("worshipsync_local_video_debug")` and reload.

USB-driver single-session behavior, actual 1080p60, resource savings, relative
delay and long-session stability remain hardware acceptance checks. No new
transport or further optimization is justified before those measurements.
