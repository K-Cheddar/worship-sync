import type { Box, LocalVideoInputMediaSource, MediaType } from "../../types";
import { MEDIA_LIBRARY_ROOT_VIEW } from "../../utils/mediaFolderMutations";

export type ShowInMediaBoxSource = Pick<Box, "mediaInfo" | "background">;

/**
 * Resolve a library media id for "Show in Media" from a slide box (and optional
 * slide-level live video input on box 0).
 */
export const resolveShowInMediaId = ({
  box,
  mediaList,
  slideVideoInput,
}: {
  box: ShowInMediaBoxSource | undefined;
  mediaList: MediaType[];
  slideVideoInput?: LocalVideoInputMediaSource;
}): string | undefined => {
  if (!box) return undefined;

  if (box.mediaInfo?.id) {
    const byId = mediaList.find((m) => m.id === box.mediaInfo!.id);
    if (byId) return byId.id;
    // Prefer the stored id anyway — the media panel resolves against its list.
    return box.mediaInfo.id;
  }

  const localImageId = box.mediaInfo?.localImage?.id;
  if (localImageId) {
    const byLocalImage = mediaList.find(
      (m) => m.id === localImageId || m.localImage?.id === localImageId,
    );
    if (byLocalImage) return byLocalImage.id;
  }

  const localVideoFileId = box.mediaInfo?.localVideoFile?.id;
  if (localVideoFileId) {
    const byLocalVideo = mediaList.find(
      (m) =>
        m.id === localVideoFileId || m.localVideoFile?.id === localVideoFileId,
    );
    if (byLocalVideo) return byLocalVideo.id;
  }

  if (box.background) {
    const byBackground = mediaList.find(
      (m) =>
        m.background === box.background ||
        m.thumbnail === box.background ||
        m.localImage?.cloudUrl === box.background ||
        m.localVideoFile?.cloudUrl === box.background,
    );
    if (byBackground) return byBackground.id;
  }

  if (slideVideoInput) {
    const byInput = mediaList.find(
      (m) => m.localVideoInput?.sourceId === slideVideoInput.sourceId,
    );
    if (byInput) return byInput.id;
  }

  return undefined;
};

/** Folder the media panel should open for a library item (root when unset). */
export const resolveShowInMediaFolderId = (
  mediaItem: Pick<MediaType, "folderId">,
): string => mediaItem.folderId ?? MEDIA_LIBRARY_ROOT_VIEW;
