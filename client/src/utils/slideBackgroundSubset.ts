import type { ItemSlideType, MediaType, SlideMediaSource } from "../types";

export type Box0BackgroundPatch = {
  background: string;
  mediaInfo?: MediaType | undefined;
  /**
   * When set, updates slide.mediaSource. Use `null` to clear a live input when
   * applying a normal image/video background.
   */
  mediaSource?: SlideMediaSource | null;
};

/** Updates box 0 background/mediaInfo on slides whose id is in `idSet`. */
export function mapSlidesUpdateBox0ById(
  slides: ItemSlideType[],
  idSet: Set<string>,
  patch: Box0BackgroundPatch,
): ItemSlideType[] {
  return slides.map((slide) => {
    if (!idSet.has(slide.id)) return slide;
    const nextBoxes = slide.boxes.map((box, index) => {
      if (index !== 0) return box;
      return {
        ...box,
        background: patch.background,
        mediaInfo: patch.mediaInfo,
      };
    });
    if (patch.mediaSource === undefined) {
      return { ...slide, boxes: nextBoxes };
    }
    if (patch.mediaSource === null) {
      const { mediaSource: _removed, ...rest } = slide;
      return { ...rest, boxes: nextBoxes };
    }
    return {
      ...slide,
      boxes: nextBoxes,
      mediaSource: patch.mediaSource,
    };
  });
}
