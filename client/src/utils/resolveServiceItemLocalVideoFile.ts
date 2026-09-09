import type { LocalVideoFileReference, MediaType, ServiceItem } from "../types";
import {
  isLocalVideoFileUrl,
  parseLocalVideoFileAssetId,
} from "./localVideoFileAssets";

/**
 * Prefer the outline row's stored localVideoFile; if an older row only has a
 * `local-video-file://` background string, recover metadata from the media library.
 */
export const resolveServiceItemLocalVideoFile = (
  item: Pick<ServiceItem, "background" | "localVideoFile">,
  mediaList: MediaType[] = [],
): LocalVideoFileReference | undefined => {
  if (item.localVideoFile) return item.localVideoFile;
  if (!isLocalVideoFileUrl(item.background)) return undefined;
  const assetId = parseLocalVideoFileAssetId(item.background);
  if (!assetId) return undefined;
  const match = mediaList.find(
    (media) =>
      media.localVideoFile?.id === assetId ||
      media.background === item.background,
  );
  return match?.localVideoFile;
};
