---
name: display-window
description: WorshipSync DisplayWindow implementation and review guide. Use when changing, debugging, reviewing, or planning work in client/src/components/DisplayWindow, projector/monitor/stream presentation output, slide crossfades, media/video/image background rendering, stream overlays, monitor layout, or related tests.
---

# Display Window

## Purpose

Use this skill to protect WorshipSync's live display surfaces. Treat DisplayWindow changes as high-risk: projector, monitor, stream, previews, Electron windows, media playback, timers, overlays, and sync behavior can all be affected by small rendering changes.

## First Checks

Start by identifying the surface and path:

- Projector browser route: `client/src/pages/Projector.tsx` → `client/src/containers/FullscreenPresentation.tsx` → `DisplayWindow`.
- Electron/projector full route: `client/src/pages/ProjectorFull.tsx` handles board takeover, then delegates to `FullscreenPresentation` in headless mode → `DisplayWindow`.
- Monitor route: `client/src/pages/Monitor.tsx` → `FullscreenPresentation` → `DisplayWindow` with full monitor layout.
- Stream route: `client/src/pages/Stream.tsx` directly renders `DisplayWindow`.
- Editing/previews: inspect the relevant editor, `PresentationPreview`, and overlay preview paths.

`FullscreenPresentation` is the shared projector/monitor fullscreen boundary. It maps current and previous presentation data, timers, output ID, transition state, local-video state, and monitor layout mode into `DisplayWindow` props. In a browser it gates rendering on browser fullscreen; Electron marks the output fullscreen, and headless projector windows bypass that gate.

Before editing, inspect:

- `client/src/components/DisplayWindow/DisplayWindow.tsx`
- `client/src/containers/FullscreenPresentation.tsx`
- The relevant subcomponent: `DisplayBox`, `DisplayStreamText`, `MonitorView`, `HLSVideoPlayer`, or overlay component.
- `client/src/store/presentationSlice.ts` when current/previous state, remote sync, overlay state, or transmission behavior matters.

## Core Model

DisplayWindow renders a fixed 1920x1080 reference surface and scales it into the measured container. Do not replace this casually with responsive layout.

Display output uses current and previous presentation state:

- Current boxes render the incoming slide.
- Previous boxes render the outgoing slide for a short crossfade window.
- Transition identity must include visual content, not only box IDs. Some slide flows reuse box IDs while changing words/backgrounds.
- Do not let stale previous layers remain mounted beyond the transition window.

Stream is special:

- The stream page background must remain transparent.
- Stream item content and stream overlays are separate lanes.
- Automatic overlay display can temporarily hide item content, but operator-controlled stream content blocking is a separate state.
- Never add black page/stage backgrounds to stream output. Projector and monitor may use black stages when intentional.
- Stream overlay timing has two authorities that must stay aligned:
  - Shared timing for cross-device send, expiry, and ordering. Use `serverNow()` plus `transitionSequence`.
  - Local render timing for letting the receiving device finish an exit animation it has already started.
- Any local finish-the-exit grace must stay render-only inside the display layer. Do not add synced Redux/Firebase writes when an exit animation completes.
- When a stream overlay moves from current to prev because of a clear or handoff, any local keep-alive must replace the old full-lifetime window with the short prev-exit window. Otherwise item content can stay hidden until the original duration expires after an early clear.
- New stream overlay types should be reviewed explicitly for shared clock usage, sequence-aware ordering, current/prev handoff safety, late-start local exit completion, and early-clear item-layer return timing.

## Transition Pitfalls

Known failure modes to guard against:

- Reused box IDs with changed lyrics can skip the previous layer if transition keys only use IDs.
- Cached media URL promotion from remote URL to `media-cache://...` can happen during a fade and cause image flashes.
- Video backgrounds can fall back to a still poster when the global video element unmounts, making video exits feel like `video -> still -> fade`.
- Stream overlays can replay old exits if stale `prev` data survives a later rerender or cross-type handoff.
- Stream item content can stay hidden too long if a cleared overlay keeps its original full-lifetime keep-alive instead of switching to the short prev-exit window.
- Image overlays are especially timing-sensitive because local animation should not start until the image is actually ready to render on that device.
- Same-background transitions should skip background animation but still animate changed text.
- Empty/image-only slides expose timing bugs that text-heavy slides can hide.
- Electron display windows may reveal one-frame timing issues that browser previews do not.

Preserve existing current/previous media layers through a fade. Keep outgoing media mounted until its exit completes and only promote incoming media after it is ready to paint.

## Media Rules

When changing image/video behavior:

- Do not change an image element's `src` mid-fade unless the underlying media changed intentionally.
- Cache promotion for the same media should wait until after transition animation.
- When transitioning from video, preserve the playing outgoing video until fade-out completes when possible.
- When transitioning to video, use a poster/still only as a readiness fallback, then fade into the playing video when ready.
- Keep HLS/local cached fallback behavior intact in `HLSVideoPlayer`.

## Review Checklist

For every DisplayWindow change, check:

- Projector browser and projector-full behavior through `FullscreenPresentation`.
- Monitor content-only and full-monitor modes through the same fullscreen boundary.
- Stream transparency and overlay/item layering.
- Stream overlay clock/order behavior when the change touches overlay timing or sync.
- Early-clear overlay behavior: item content should return after the short exit, not after the original overlay duration.
- Late-start device behavior: an overlay that starts locally a bit late should still finish its local exit cleanly.
- Current/previous state behavior for slide, text, Bible, free text, timer, image, and video cases.
- Image-only, no-text, and reused-box-ID lyric transitions.
- Video-to-text, text-to-video, video-to-video, image-to-image, and text-to-text transitions when media code changes.
- Electron-only window behavior if the issue was seen in Electron.

## Testing

Run focused tests first:

```powershell
npm.cmd test --prefix client -- --watchAll=false --runInBand src/components/DisplayWindow/__tests__
```

For narrower changes, include the relevant test file plus `DisplayWindow.corePaths.test.tsx`.

For stream overlay timing changes, expect to cover:

- `DisplayWindow.corePaths.test.tsx` for shared-clock expiry, replay prevention, late-start exit completion, and early-clear item-layer return.
- The overlay component test for the specific overlay type.
  - For image overlays, include `DisplayImageOverlay.test.tsx` because local readiness/load timing can change when keep-alive starts.

Before calling the work production-ready, run:

```powershell
npm.cmd run build:strict --prefix client
```

If full verification is not practical, state exactly what was and was not validated.
