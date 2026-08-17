import type { ItemSlideType, MediaType } from "../types";

export type Box0BackgroundPatch = {
  background: string;
  mediaInfo?: MediaType | undefined;
};

/** Applies a media background to box 0 without disturbing text/overlay boxes. */
export function updateSlideBackgroundLayer(
  slide: ItemSlideType,
  patch: Box0BackgroundPatch,
): ItemSlideType {
  return {
    ...slide,
    mediaSource: patch.mediaInfo?.localVideoInput,
    boxes: slide.boxes.map((box, index) => {
      if (index !== 0) return box;
      return {
        ...box,
        background: patch.background,
        mediaInfo: patch.mediaInfo,
      };
    }),
  };
}

/** Updates box 0 background/mediaInfo on slides whose id is in `idSet`. */
export function mapSlidesUpdateBox0ById(
  slides: ItemSlideType[],
  idSet: Set<string>,
  patch: Box0BackgroundPatch,
): ItemSlideType[] {
  return slides.map((slide) => {
    if (!idSet.has(slide.id)) return slide;
    return updateSlideBackgroundLayer(slide, patch);
  });
}
