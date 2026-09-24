import type { MediaType } from "../types";
import { extractPublicId } from "./cloudinaryUtils";

/** Stable provider identity used for safe cleanup and retry deduplication. */
export const getCanvaProviderIdentity = (row: MediaType): string => {
  if (row.source === "cloudinary") {
    return row.publicId || extractPublicId(row.background) || "";
  }
  if (row.source === "mux") return row.muxAssetId || "";
  return "";
};

export const getCanvaProviderCleanupKey = (row: MediaType): string => {
  const identity = getCanvaProviderIdentity(row);
  return identity ? `${row.source}:${identity}` : `media:${row.id}`;
};
