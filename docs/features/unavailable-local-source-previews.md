# Feature Contract: Unavailable local-source previews

**Contract status:** Confirmed product intent

**Approval source:** Current user request, November 18, 2026; live local-video fallback request, November 19, 2026; thumbnail presentation request, November 24, 2026.

**Last reviewed:** November 24, 2026

## Purpose

Help operators distinguish a genuinely empty slide from a local image, video, camera, screen share, or window share that this device cannot preview.

## Operator workflow

Operators inspect slides in the editor, service-plan thumbnails, Media Library previews, and projector, monitor, or stream preview cards before presenting. When a preview cannot access its local source, it identifies the source and its owning device when that information is available.

## Expected behavior

- A source owned by another device with no usable local or cloud media is identified as **Local source on another device**.
- A missing local image or video on its owning device is identified as **Local image unavailable** or **Local video unavailable** and includes the existing relink guidance.
- Cameras and screen/window captures use wording appropriate to their source type. Persisted ownership metadata is enough to explain an unavailable preview; previewing must not create a hardware binding or change capture ownership.
- Loading remains distinct from unavailable. A ready local or cloud-backed preview removes the status automatically.
- A local video with a playable cloud fallback remains playable and is not marked unavailable because its local file or thumbnail is missing.
- Availability is resolved independently by each rendering device. A live output with no usable local or cloud video immediately clears that video's still and shows black; an available owner device continues playback.
- The A/B transition may not hold its previous lane indefinitely after a local video becomes explicitly unavailable. Ordinary loading and buffering keep the existing readiness and transition behavior.
- Projector, Monitor, Stream, and Aux output routes show no unavailable-source diagnostics. The Stream fallback uses black only for the current item-media layer; its separate overlay lane remains visible.
- Controller Projector, Monitor, and Stream previews show a black unavailable-video placeholder with the unavailable-source icon, filename or title, **Local video unavailable on this device**, and **Source is local to another device**. Preview copy describes source ownership only; it does not claim playback is active elsewhere.
- Stream slide thumbnails match the transparent stream item layer: they omit stills and poster images for slide background media. Captured camera or other local video-input stills remain visible because that separate input lane is part of stream output.
- Status UI uses the shared `LocalSourceStatus` treatment. Full editor and standalone previews include the source name and owner when available. Thumbnail diagnostics use reference-space typography inside the shared 1920×1080 canvas so text, icons, spacing, and padding scale with slide content and stay within the tile. Long source and owner labels wrap within the status and remain available through its accessible label and title.
- Compact item-list row thumbnails show only the unavailable-source icon; the status keeps its full accessible label and title, while larger slide previews retain the detailed message.
- An unavailable capture without a usable saved thumbnail has one centered, proportionally scaled status with the source type, source name, unavailable message, and owner when available. When a saved thumbnail exists, the still remains visible with one compact unavailable indicator. Available captures keep their source identification, and loading stays distinct where applicable.
- Thumbnail and slide-tile stacking contexts contain diagnostic overlays below controller drawers and other application surfaces. Internal status and badge z-indexes only order content within their own preview tile.
- Filesystem paths and unnecessary identifiers are not shown.
- Display-specific settings that hide a background also hide its unavailable status. Empty or intentionally black slides remain unchanged.
- Operator diagnostics may appear in editors and controller preview cards. They must not appear on audience-facing projector, monitor, or stream outputs. Stream preview surfaces remain transparent.
- Warnings do not start media playback or decoding, and item-slide virtualization remains in place.

## Product decisions

- **Unavailable live local video:** If one renderer cannot resolve a local video and has no playable cloud fallback, its physical output clears the prior video visual and renders black. The controller preview identifies the unavailable source. Availability remains renderer-local so the device owning the file can play it. This avoids presenting a stale prior image as the current live selection. The material alternative—retaining the previous frame—can mislead the operator. **Approval source:** current user request, November 19, 2026.
- **Stream slide-thumbnail parity:** When Stream is selected, slide thumbnails omit saved stills for slide background media, matching the transparent text/overlay composition of the live Stream renderer. Captured local video-input stills remain because they represent a distinct stream underlay. **Approval source:** current user request, November 24, 2026.
- **Thumbnail status scaling and containment:** Thumbnail diagnostic typography and spacing use the shared reference canvas and scale with slide content. An unavailable capture uses a single detailed status without a saved still, or one compact indicator over a saved still; slide-tile stacking contexts keep both below application drawers. **Approval source:** current user request, November 24, 2026.
- **Compact item-list thumbnail status:** Unavailable local sources in the item list use only the warning icon in the small row thumbnail; accessible status text retains the source details, and larger previews keep their diagnostic copy. **Approval source:** current user request, November 24, 2026.

## Implementation references

- Shared status: `client/src/components/DisplayWindow/LocalSourceStatus.tsx`
- Terminal local-video availability: `client/src/hooks/useLocalVideoFileUrl.ts`
- Display surfaces: `client/src/components/DisplayWindow/DisplayWindow.tsx`, `DisplayBox.tsx`, `DisplayEditor.tsx`, `LocalVideoInputView.tsx`, `MonitorBandBackground.tsx`
- Item previews: `client/src/containers/ItemSlides/StaticSlideThumbnail.tsx`, `StaticMonitorThumbnail.tsx`, `ItemSlide.tsx`, `ContinuousStaticItemSlide.tsx`
- Media previews: `client/src/containers/Media/MediaModal.tsx`, `MediaLibraryMediaVisual.tsx`
- Ownership and availability: `client/src/hooks/useLocalImageUrl.ts`, `useLocalVideoFileUrl.ts`, `client/src/utils/localVideoInput.ts`
- Tests: DisplayWindow local-source tests, static thumbnail tests, Media Library preview tests, and local video input utility tests.
