# Feature Contract: Local video input thumbnails

**Contract status:** Confirmed product intent

**Approval source:** Current user request, November 5, 2026.

**Last reviewed:** November 6, 2026

## Purpose

Let operators recognize a local camera or screen input in Media and static item-slide previews when its live source is unavailable.

## Operator workflow

An operator opens Add/Relink for a local video input, captures a frame from its current preview, reviews it, and saves it as the input thumbnail. For a new input, Add to Media saves the input and captured frame together. For an existing input, Save local link saves the relink and any newly captured frame together. The separate Save thumbnail action remains available, and Save local link does not upload a frame that was already saved. Operators can retake or remove the saved thumbnail.

## Expected behavior

- Capture happens only after an operator asks for it.
- The saved still appears in the Media Library and in static item-slide previews that reference the same source.
- A cloud-backed replacement keeps the prior cloud copy until the new one is uploaded and committed. A local-only replacement keeps it until the new local reference commits, then clears the old cloud reference and durably schedules its deletion.
- Replacing a thumbnail does not overwrite an active upload job; its lease and provider checkpoints remain until upload cancellation or completion is reconciled.
- Relinking without a new capture leaves the existing thumbnail and local image reference unchanged.
- An explicit thumbnail removal remains in effect when the operator saves the local link.
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
| Normal workflow | Capture, preview, and save the selected input's current frame; Save local link includes a newly captured frame for existing inputs. | Picker regression tests cover existing input capture plus Save local link and the optional separate Save thumbnail action. | Confirmed by current request |
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
- **Question/problem:** What should happen to the prior cloud thumbnail when an operator chooses a local-only replacement while its upload is still running?
- **Approved behavior:** Commit the local-only reference with the old cloud URL cleared and cloud deletion durably scheduled. Preserve the existing upload job and its provider checkpoints until the upload is cancelled or completes safely; retire its job only after reconciliation.
- **Why:** Other devices should not keep displaying a retired cloud thumbnail, and an in-flight provider operation must retain enough state to finish or recover safely.
- **Approval source/date:** Current user request, November 6, 2026.
- **Affected workflow/contract:** Media management and thumbnail upload recovery.
- **Question/problem:** What is the durable commit order for a cloud-backed thumbnail upload?
- **Approved behavior:** Persist a non-runnable upload intent before committing the Media reference. Activate it only after an authoritative read confirms that the same Media row and local asset still match. On restart, reconcile staged intents against their originating church's Media document; uncertain reads preserve the intent and local image, while confirmed supersession retires the intent without deleting any still-referenced local asset.
- **Why:** A reload or failed verification read must not strand a Media row marked for cloud storage without a durable upload job, and an uncommitted thumbnail must never upload.
- **Approval source/date:** Current user request, November 6, 2026.
- **Affected workflow/contract:** Media management and thumbnail upload recovery.

## Implementation references

- Entry point: `client/src/containers/Media/Media.tsx`
- Capture and persistence: `client/src/components/LocalVideoInputPicker/LocalVideoInputPicker.tsx`, `client/src/utils/localVideoInputThumbnail.ts`, `client/src/utils/localImageAssets.ts`
- Rendering: `client/src/containers/Media/MediaLibraryMediaVisual.tsx`, `client/src/containers/ItemSlides/ItemSlides.tsx`, `client/src/containers/ItemSlides/ItemSlide.tsx`
- Upload and cleanup: `client/src/components/LocalImageUploadManager/LocalImageUploadManager.tsx`
- Tests: `client/src/components/LocalVideoInputPicker/LocalVideoInputPicker.test.tsx`, `client/src/components/LocalImageUploadManager/LocalImageUploadManager.test.tsx`, `client/src/containers/ItemSlides/ItemSlide.mediaInsertion.test.tsx`

## Technical design notes

The picker encodes one frame from its already-visible video or desktop preview, capped at 640×360 with aspect ratio preserved. A same-source preview restart preserves a captured frame so a failed save can be retried. The Media row stores only a `LocalImageAssetReference`. Source relinks and thumbnail changes patch the existing Media row through the v2 document merge, preserving unrelated fields. Thumbnail save and removal share one per-database, per-row mutation queue. Cloud upload intents are durably staged in IndexedDB before the Media commit and remain non-runnable until the originating Media row is authoritatively confirmed. A short local session heartbeat prevents another active tab from retiring an intent while its Media write is still in flight; restart recovery reconciles it after that session expires. The upload job names the existing input row as its target, guards stale retakes, preserves the live source fields, and retries prior asset cleanup only after checking Media references.
