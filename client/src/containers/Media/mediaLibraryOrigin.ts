import type { MediaType } from "../../types";

export const MEDIA_LIBRARY_ORIGINS = [
  "uploaded",
  "local",
  "video-input",
  "canva",
] as const;

export type MediaLibraryOrigin = (typeof MEDIA_LIBRARY_ORIGINS)[number];

export type MediaOriginFilterValue = "all" | MediaLibraryOrigin;

type OriginMediaFields = Pick<
  MediaType,
  | "source"
  | "localVideoInput"
  | "localImage"
  | "localVideoFile"
  | "canvaImportKey"
  | "canvaSource"
>;

export const MEDIA_LIBRARY_ORIGIN_FILTER_LABELS: Record<
  MediaOriginFilterValue,
  string
> = {
  all: "All sources",
  uploaded: "Uploaded",
  local: "Local",
  "video-input": "Video inputs",
  canva: "Canva",
};

export const MEDIA_LIBRARY_ORIGIN_BADGE_LABELS: Record<
  Exclude<MediaLibraryOrigin, "uploaded">,
  string
> = {
  local: "Local",
  "video-input": "Video input",
  canva: "Canva",
};

export const MEDIA_LIBRARY_ORIGIN_META_LABELS: Record<
  MediaLibraryOrigin,
  string
> = {
  uploaded: "uploaded",
  local: "local",
  "video-input": "video input",
  canva: "canva",
};

export const MEDIA_LIBRARY_ORIGIN_FILTER_OPTIONS: {
  value: MediaOriginFilterValue;
  label: string;
}[] = (["all", ...MEDIA_LIBRARY_ORIGINS] as const).map((value) => ({
  value,
  label: MEDIA_LIBRARY_ORIGIN_FILTER_LABELS[value],
}));

const ORIGIN_FILTER_VALUES = new Set<string>(
  MEDIA_LIBRARY_ORIGIN_FILTER_OPTIONS.map((option) => option.value),
);

export const isMediaOriginFilterValue = (
  value: string,
): value is MediaOriginFilterValue => ORIGIN_FILTER_VALUES.has(value);

/** Most specific supported origin wins: live input, local file, Canva, then upload. */
export const getMediaLibraryOrigin = (
  media: OriginMediaFields,
): MediaLibraryOrigin => {
  if (media.localVideoInput) return "video-input";
  if (media.localImage || media.localVideoFile || media.source === "local") {
    return "local";
  }
  if (media.canvaSource || media.canvaImportKey) return "canva";
  return "uploaded";
};

export const mediaMatchesOriginFilter = (
  media: OriginMediaFields,
  filter: MediaOriginFilterValue,
) => filter === "all" || getMediaLibraryOrigin(media) === filter;

export const getMediaLibraryOriginBadgeLabel = (media: OriginMediaFields) => {
  const origin = getMediaLibraryOrigin(media);
  if (origin === "uploaded") return null;
  return MEDIA_LIBRARY_ORIGIN_BADGE_LABELS[origin];
};
