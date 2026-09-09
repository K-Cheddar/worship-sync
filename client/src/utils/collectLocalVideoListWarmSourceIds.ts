import type { DBItem, ItemSlideType, ServiceItem } from "../types";
import { parseLocalVideoInputSourceId } from "./localMediaReferenceUrl";
import {
  isDesktopCaptureKind,
  resolveLocalVideoInputBinding,
} from "./localVideoInput";
import { resolveSlidesForOutlineItem } from "./outlineSlideSections";

type ItemWithSlides = {
  _id?: string;
  listId?: string;
  type?: string;
  slides?: ItemSlideType[];
  arrangements?: { slides?: ItemSlideType[] }[];
  selectedArrangement?: number;
};

const addIfWarmableDevice = (sourceIds: Set<string>, sourceId: string) => {
  const binding = resolveLocalVideoInputBinding(sourceId);
  if (!binding) return;
  if (isDesktopCaptureKind(binding.captureKind)) return;
  sourceIds.add(sourceId);
};

const collectFromSlides = (
  sourceIds: Set<string>,
  slides: ItemSlideType[] | undefined,
) => {
  slides?.forEach((slide) => {
    if (slide.mediaSource?.kind === "local-video-input") {
      addIfWarmableDevice(sourceIds, slide.mediaSource.sourceId);
    }
    slide.boxes?.forEach((box) => {
      const fromBox = parseLocalVideoInputSourceId(box.background);
      if (fromBox) addIfWarmableDevice(sourceIds, fromBox);
    });
  });
};

const collectFromOpenItemSlides = (
  sourceIds: Set<string>,
  openItem: ItemWithSlides,
) => {
  collectFromSlides(sourceIds, openItem.slides);
  const arrangementSlides =
    openItem.arrangements?.[openItem.selectedArrangement ?? 0]?.slides;
  collectFromSlides(sourceIds, arrangementSlides);
};

/**
 * Hardware inputs referenced by the current outline (item backgrounds and
 * per-slide backgrounds on list items) or the open item should stay warm so
 * the first send does not reopen the camera. Screen/window shares stay
 * click-to-start.
 */
export const collectLocalVideoListWarmSourceIds = (args: {
  itemList: Pick<ServiceItem, "_id" | "listId" | "type" | "background">[];
  openItem?: ItemWithSlides | null;
  docsById?: Map<string, DBItem>;
}): string[] => {
  const sourceIds = new Set<string>();
  const docsById = args.docsById ?? new Map();
  const openItem = args.openItem;

  args.itemList.forEach((item) => {
    const fromBackground = parseLocalVideoInputSourceId(item.background);
    if (fromBackground) addIfWarmableDevice(sourceIds, fromBackground);

    const slides = resolveSlidesForOutlineItem(item, {
      activeItem: openItem ?? {},
      docsById,
    });
    collectFromSlides(sourceIds, slides);
  });

  // Open item not on the outline still contributes its in-memory slides.
  if (openItem?._id) {
    const onList = args.itemList.some(
      (item) => item._id === openItem._id && item.listId === openItem.listId,
    );
    if (!onList) {
      collectFromOpenItemSlides(sourceIds, openItem);
    }
  }

  return [...sourceIds].sort();
};
