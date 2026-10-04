import type { Arrangment, DBItem, ItemSlideType, ItemState, MonitorLayout } from "../types";
import { getMonitorLayoutForSlides } from "./monitorSlideFormatter";

/** The editor and controller's canonical slide collection. */
export const getActiveItemSlides = (
  item: Pick<ItemState, "type" | "arrangements" | "selectedArrangement" | "slides">,
): ItemSlideType[] =>
  item.type === "song"
    ? (item.arrangements[item.selectedArrangement]?.slides ?? [])
    : item.slides;

/** Writes a song's normalized legacy root slides into its selected arrangement once. */
export const normalizeLegacySongSlides = <T extends {
  _id?: string;
  name?: string;
  type?: string;
  selectedArrangement?: number;
  arrangements?: Arrangment[];
  slides?: ItemSlideType[];
}>(item: T): T => {
  if (item.type !== "song") return item;
  const arrangements = [...(item.arrangements ?? [])];
  const rootSlides = item.slides ?? [];
  let selectedArrangement = Math.max(0, item.selectedArrangement ?? 0);
  if (!arrangements.length && rootSlides.length) {
    selectedArrangement = 0;
    arrangements.push({
      id: `legacy-${item._id ?? "song"}`,
      name: item.name ?? "Arrangement",
      formattedLyrics: [],
      songOrder: [],
      slides: rootSlides,
    });
  } else if (arrangements.length) {
    selectedArrangement = Math.min(selectedArrangement, arrangements.length - 1);
    const selectedSlides = arrangements[selectedArrangement]?.slides ?? [];
    if (!selectedSlides.length && rootSlides.length) {
      arrangements[selectedArrangement] = {
        ...arrangements[selectedArrangement],
        slides: rootSlides,
      };
    }
  }
  return { ...item, arrangements, selectedArrangement, slides: [] };
};


const withoutLegacyMonitorBoxes = (slide: ItemSlideType): ItemSlideType => {
  if (
    !("monitorCurrentBandBoxes" in slide) &&
    !("monitorNextBandBoxes" in slide)
  ) return slide;
  const { monitorCurrentBandBoxes: _current, monitorNextBandBoxes: _next, ...clean } = slide;
  return clean;
};

const legacyFontSize = (boxes: ItemSlideType["boxes"] | undefined) =>
  boxes?.[0]?.monitorFontSizePx ?? boxes?.[0]?.fontSize;

export const getMonitorLayoutFromLegacySlides = (slides: ItemSlideType[]): MonitorLayout | undefined => {
  const currentFontSizePx = slides
    .map((slide) => legacyFontSize(slide.monitorCurrentBandBoxes))
    .find((size): size is number => size != null);
  const nextFontSizePx = slides
    .map((slide) => legacyFontSize(slide.monitorNextBandBoxes))
    .find((size): size is number => size != null);
  if (currentFontSizePx == null && nextFontSizePx == null) return undefined;
  return {
    currentFontSizePx: currentFontSizePx ?? nextFontSizePx!,
    nextFontSizePx: nextFontSizePx ?? currentFontSizePx!,
  };
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

/** Cleans song library state without measuring monitor layout for every document. */
export const normalizeSongForLibrary = <T extends {
  _id?: string;
  name?: string;
  type?: string;
  selectedArrangement?: number;
  arrangements?: Arrangment[];
  slides?: ItemSlideType[];
  monitorLayout?: MonitorLayout;
}>(item: T): T => {
  if (item.type !== "song") return item;
  const normalized = normalizeLegacySongSlides(item);
  const arrangements = (normalized.arrangements ?? []).map((arrangement) => {
    const slides = arrangement.slides ?? [];
    const monitorLayout =
      arrangement.monitorLayout ?? getMonitorLayoutFromLegacySlides(slides);
    return {
      ...arrangement,
      ...(monitorLayout ? { monitorLayout } : {}),
      slides: slides.map(withoutLegacyMonitorBoxes),
    };
  });
  const libraryDoc = { ...normalized, arrangements };
  delete (libraryDoc as { slides?: ItemSlideType[] }).slides;
  delete (libraryDoc as { monitorLayout?: MonitorLayout }).monitorLayout;
  return libraryDoc;
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
