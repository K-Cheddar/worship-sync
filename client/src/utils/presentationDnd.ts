import {
  closestCenter,
  pointerWithin,
  type CollisionDetection,
} from "@dnd-kit/core";

export type MediaDragData = {
  kind: "media";
  mediaIds: string[];
};

export type SlideDragData = {
  kind: "slide";
  slideId: string;
};

export type SlideInsertData = {
  kind: "slide-insert";
  index: number;
};

export type SlideContainerDropData = {
  kind: "slide-container";
};

export type PresentationDndData =
  | MediaDragData
  | SlideDragData
  | SlideInsertData
  | SlideContainerDropData;

export const presentationCollisionDetection: CollisionDetection = (args) => {
  if (isMediaDragData(args.active.data.current)) {
    const pointerCollisions = pointerWithin(args);
    const slideInsertCollisions = pointerCollisions.filter(({ data }) =>
      isSlideInsertData(data?.droppableContainer?.data?.current),
    );
    if (slideInsertCollisions.length > 0) return slideInsertCollisions;
    return pointerCollisions.filter(({ data }) =>
      isSlideContainerData(data?.droppableContainer?.data?.current),
    );
  }

  return closestCenter(args).filter(
    ({ data }) => {
      const targetData = data?.droppableContainer?.data?.current;
      return !isSlideInsertData(targetData) && !isSlideContainerData(targetData);
    },
  );
};

export const isMediaDragData = (
  data: unknown,
): data is MediaDragData =>
  typeof data === "object" &&
  data !== null &&
  (data as { kind?: unknown }).kind === "media" &&
  Array.isArray((data as { mediaIds?: unknown }).mediaIds);

export const isSlideDragData = (
  data: unknown,
): data is SlideDragData =>
  typeof data === "object" &&
  data !== null &&
  (data as { kind?: unknown }).kind === "slide" &&
  typeof (data as { slideId?: unknown }).slideId === "string";

export const isSlideInsertData = (
  data: unknown,
): data is SlideInsertData =>
  typeof data === "object" &&
  data !== null &&
  (data as { kind?: unknown }).kind === "slide-insert" &&
  typeof (data as { index?: unknown }).index === "number";

export const isSlideContainerData = (
  data: unknown,
): data is SlideContainerDropData =>
  typeof data === "object" &&
  data !== null &&
  (data as { kind?: unknown }).kind === "slide-container";
