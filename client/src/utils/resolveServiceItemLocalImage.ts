import type {
  LocalImageAssetReference,
  MediaType,
  ServiceItem,
} from "../types";
import { isLocalImageUrl, parseLocalImageAssetId } from "./localImageAssets";

/**
 * Prefer the outline row's stored localImage; if an older row only has a
 * `local-image://` background string, recover metadata from the media library.
 */
export const resolveServiceItemLocalImage = (
  item: Pick<ServiceItem, "background" | "localImage">,
  mediaList: MediaType[] = [],
): LocalImageAssetReference | undefined => {
  if (item.localImage) return item.localImage;
  if (!isLocalImageUrl(item.background)) return undefined;
  const assetId = parseLocalImageAssetId(item.background);
  if (!assetId) return undefined;
  const match = mediaList.find(
    (media) =>
      media.localImage?.id === assetId || media.background === item.background,
  );
  return match?.localImage;
};
