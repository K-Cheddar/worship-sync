# Feature Contract: Local video input thumbnails

**Contract status:** Confirmed product intent

**Approval source:** Current user request, November 5, 2026.

**Last reviewed:** November 5, 2026

## Purpose

Let operators recognize a local camera or screen input in Media and static item-slide previews when its live source is unavailable.

## Operator workflow

An operator opens Add/Relink for a local video input, captures a frame from its current preview, reviews it, and saves it as the input thumbnail. They can retake or remove the saved thumbnail. When adding a new input, Add to Media can save a captured frame with it.

## Expected behavior

- Capture happens only after an operator asks for it.
- The saved still appears in the Media Library and in static item-slide previews that reference the same source.
- Replacing a thumbnail keeps the prior cloud copy available until the replacement is uploaded and committed.
- Removing a thumbnail keeps the Media input and its live binding; only the representative image is removed.
- A saved thumbnail remains separate from the live input source ID and device ownership metadata.
- Thumbnail storage follows the existing local image storage preference and its cloud upload and quota lifecycle.

## Behavioral boundaries

- Item-slide grids show a static image and never play the live camera.
- Projector, monitor, stream, and Aux outputs continue using the live video input.
- Capturing or saving a still does not acquire a second camera stream or change capture resolution or frame rate.
- Thumbnail changes do not create another Media item or rewrite item slide documents.

## Important scenarios

| Scenario | Confirmed expected behavior | Current implementation or test evidence | Status / open question |
| --- | --- | --- | --- |
| Normal workflow | Capture, preview, and save the selected input's current frame. | `LocalVideoInputPicker` uses the visible preview and the local image asset pipeline. | Confirmed by current request |
| Repeated or explicit action | Retake replaces only after save; removal leaves the input. | Upload jobs target the existing Media ID and carry cleanup checkpoints. | Confirmed by current request |
| Manual change | Users choose when to capture and may remove the still. | Capture, save, retake, and remove controls are explicit. | Confirmed by current request |
| Missing or unavailable source | Keep the saved still recognizable and report capture unavailability. | Media and static slide renderers resolve stored or cloud thumbnails. | Confirmed by current request |
| Error or recovery | A failed save leaves the prior thumbnail; failed asset cleanup remains retryable. | The local image upload manager checkpoints cloud and cleanup work. | Confirmed by current request |
| Other important edge case | Multiple slides sharing a source resolve one Media thumbnail without changing output data. | `ItemSlides` resolves the source from the Media list; output paths do not use the preview copy. | Confirmed by current request |

## Product decisions

- **Question/problem:** How should a thumbnail captured from a local device be stored and shared?
- **Approved behavior:** Use existing local image assets and the remembered local/cloud preference; when cloud upload is selected, use the existing signed upload, quota, retry, and cleanup path.
- **Why:** This keeps image bytes out of synced Media documents while allowing cloud-backed thumbnails to appear on other computers.
- **Material alternative rejected:** A separate thumbnail store or embedding the image in Media/slide documents.
- **Approval source/date:** Current user request, November 5, 2026.
- **Affected workflow/contract:** Media management and static item-slide previews.

## Implementation references

- Entry point: `client/src/containers/Media/Media.tsx`
- Capture and persistence: `client/src/components/LocalVideoInputPicker/LocalVideoInputPicker.tsx`, `client/src/utils/localVideoInputThumbnail.ts`, `client/src/utils/localImageAssets.ts`
- Rendering: `client/src/containers/Media/MediaLibraryMediaVisual.tsx`, `client/src/containers/ItemSlides/ItemSlides.tsx`, `client/src/containers/ItemSlides/ItemSlide.tsx`
- Upload and cleanup: `client/src/components/LocalImageUploadManager/LocalImageUploadManager.tsx`
- Tests: `client/src/components/LocalVideoInputPicker/LocalVideoInputPicker.test.tsx`, `client/src/components/LocalImageUploadManager/LocalImageUploadManager.test.tsx`, `client/src/containers/ItemSlides/ItemSlide.mediaInsertion.test.tsx`

## Technical design notes

The picker encodes one frame from its already-visible video or desktop preview, capped at 640×360 with aspect ratio preserved. The Media row stores only a `LocalImageAssetReference`. The upload job names the existing input row as its target, guards stale retakes, preserves the live source fields, and retries prior asset cleanup.
