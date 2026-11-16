import type { Arrangment, DBItem, ItemSlideType, MonitorLayout } from "../types";

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
  if (!("monitorCurrentBandBoxes" in slide) && !("monitorNextBandBoxes" in slide)) return slide;
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

/** Song-only structural normalization used by the v2 codec and Node migration tooling. */
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
    const monitorLayout = arrangement.monitorLayout ?? getMonitorLayoutFromLegacySlides(slides);
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

/** Hydrates all authored slides without invoking DOM-backed monitor measurement. */
export const normalizeSongForV2Hydration = <T extends DBItem>(item: T): T => {
  if (item.type !== "song") return item;
  const normalized = normalizeLegacySongSlides(item);
  const arrangements = (normalized.arrangements ?? []).map((arrangement) => {
    const slides = arrangement.slides ?? [];
    const monitorLayout = arrangement.monitorLayout ?? getMonitorLayoutFromLegacySlides(slides);
    return {
      ...arrangement,
      ...(monitorLayout ? { monitorLayout } : {}),
      slides: slides.map(withoutLegacyMonitorBoxes),
    };
  });
  return { ...normalized, arrangements, slides: [], monitorLayout: undefined } as T;
};
