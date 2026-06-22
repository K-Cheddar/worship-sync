import type { OverlayInfo } from "../../types";

export const moveOverlayAfterServicePlanningAnchor = (
  list: OverlayInfo[],
  overlayId: string,
  insertAfterId?: string,
): OverlayInfo[] => {
  if (!overlayId || overlayId === insertAfterId) return list;

  const currentIndex = list.findIndex((overlay) => overlay.id === overlayId);
  if (currentIndex === -1) return list;

  const overlay = list[currentIndex];
  const withoutOverlay = list.filter((item) => item.id !== overlayId);
  const insertIndex =
    insertAfterId === undefined
      ? 0
      : withoutOverlay.findIndex((item) => item.id === insertAfterId) + 1;
  const safeInsertIndex =
    insertAfterId !== undefined && insertIndex === 0
      ? withoutOverlay.length
      : insertIndex;

  const next = [...withoutOverlay];
  next.splice(safeInsertIndex, 0, overlay);

  const orderChanged = next.some((item, index) => item.id !== list[index]?.id);
  return orderChanged ? next : list;
};
