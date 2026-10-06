import type { Arrangment, DBItem, ItemSlideType, ItemState, MonitorLayout } from "../types";
import { getMonitorLayoutForSlides } from "./monitorSlideFormatter";
import {
  getMonitorLayoutFromLegacySlides,
  normalizeLegacySongSlides,
} from "./songNormalization";

export { getMonitorLayoutFromLegacySlides, normalizeLegacySongSlides, normalizeSongForLibrary } from "./songNormalization";

/** The editor and controller's canonical slide collection. */
export const getActiveItemSlides = (
  item: Pick<ItemState, "type" | "arrangements" | "selectedArrangement" | "slides">,
): ItemSlideType[] =>
  item.type === "song"
    ? (item.arrangements[item.selectedArrangement]?.slides ?? [])
    : item.slides;

const withoutLegacyMonitorBoxes = (slide: ItemSlideType): ItemSlideType => {
  if (
    !("monitorCurrentBandBoxes" in slide) &&
    !("monitorNextBandBoxes" in slide)
  ) return slide;
  const { monitorCurrentBandBoxes: _current, monitorNextBandBoxes: _next, ...clean } = slide;
  return clean;
};

/** Converts persisted full monitor-box clones into compact layout data at the load boundary. */
export const normalizeItemSlides = <T extends {
  _id?: string;
  name?: string;
  type?: string;
  selectedArrangement?: number;
  arrangements?: Arrangment[];
  slides?: ItemSlideType[];
  monitorLayout?: MonitorLayout;
}>(item: T): T => {
  const rootSlides = item.slides ?? [];
  if (item.type === "song") {
    const normalized = normalizeLegacySongSlides(item);
    let arrangements = [...(normalized.arrangements ?? [])];
    arrangements = arrangements.map((arrangement) => {
      const slides = arrangement.slides ?? [];
      const monitorLayout =
        arrangement.monitorLayout ??
        getMonitorLayoutFromLegacySlides(slides) ??
        (slides.length ? getMonitorLayoutForSlides(slides) : undefined);
      return {
        ...arrangement,
        ...(monitorLayout ? { monitorLayout } : {}),
        slides: slides.map(withoutLegacyMonitorBoxes),
      };
    });
    return { ...normalized, arrangements, slides: [], monitorLayout: undefined };
  }

  const monitorLayout =
    item.monitorLayout ??
    getMonitorLayoutFromLegacySlides(rootSlides) ??
    (rootSlides.length ? getMonitorLayoutForSlides(rootSlides) : undefined);
  return {
    ...item,
    ...(monitorLayout ? { monitorLayout } : {}),
    slides: rootSlides.map(withoutLegacyMonitorBoxes),
  };
};

/** Prepares a song document for persistence while preserving legacy slide recovery. */
export const normalizeSongForPersistence = <T extends DBItem>(item: T): T => {
  const normalized = normalizeItemSlides(item);
  if (normalized.type !== "song") return normalized;
  const persisted = { ...normalized };
  delete (persisted as Partial<DBItem>).slides;
  delete (persisted as Partial<DBItem>).monitorLayout;
  return persisted;
};

export type SerializedSongSizeReport = {
  legacyBytes: number;
  normalizedBytes: number;
  bytesRemoved: number;
  reductionPercent: number;
};

/** Compares a legacy song payload with the compact document shape without mutating either. */
export const getSerializedSongSizeReport = (song: DBItem): SerializedSongSizeReport => {
  const legacyBytes = new TextEncoder().encode(JSON.stringify(song)).length;
  const normalized = normalizeItemSlides(song);
  const { slides: _rootSlides, ...songWithoutRootSlides } = normalized;
  const normalizedBytes = new TextEncoder().encode(JSON.stringify(songWithoutRootSlides)).length;
  const bytesRemoved = Math.max(0, legacyBytes - normalizedBytes);
  return {
    legacyBytes,
    normalizedBytes,
    bytesRemoved,
    reductionPercent: legacyBytes ? (bytesRemoved / legacyBytes) * 100 : 0,
  };
};
