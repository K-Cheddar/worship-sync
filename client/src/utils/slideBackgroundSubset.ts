import type { ItemSlideType, MediaType } from "../types";

export type Box0BackgroundPatch = {
  background: string;
  mediaInfo?: MediaType | undefined;
};

/** Updates box 0 background/mediaInfo on slides whose id is in `idSet`. */
export function mapSlidesUpdateBox0ById(
  slides: ItemSlideType[],
  idSet: Set<string>,
  patch: Box0BackgroundPatch,
): ItemSlideType[] {
  return slides.map((slide) => {
    if (!idSet.has(slide.id)) return slide;
    return {
      ...slide,
      boxes: slide.boxes.map((box, index) => {
        if (index !== 0) return box;
        return {
          ...box,
          background: patch.background,
          mediaInfo: patch.mediaInfo,
        };
      }),
    };
  });
}
