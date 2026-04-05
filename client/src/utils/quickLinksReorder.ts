import { arrayMove } from "@dnd-kit/sortable";
import type { QuickLinkType } from "../types";

/**
 * Reorders quick links within the same display type (projector / monitor / stream).
 * Returns null when the move is invalid or would cross display groups.
 */
export const applyQuickLinkReorder = (
  quickLinks: QuickLinkType[],
  streamOnly: boolean,
  activeId: string,
  overId: string
): QuickLinkType[] | null => {
  if (activeId === overId) return null;

  const projector = quickLinks.filter((q) => q.displayType === "projector");
  const monitor = quickLinks.filter((q) => q.displayType === "monitor");
  const stream = quickLinks.filter((q) => q.displayType === "stream");

  const visible = streamOnly
    ? stream
    : [...projector, ...monitor, ...stream];

  const ids = visible.map((q) => q.id);
  const oldIndex = ids.indexOf(activeId);
  const newIndex = ids.indexOf(overId);
  if (oldIndex === -1 || newIndex === -1) return null;

  const activeType = visible[oldIndex].displayType;
  const overType = visible[newIndex].displayType;
  if (activeType !== overType) return null;

  const reorderedVisible = arrayMove(visible, oldIndex, newIndex);

  if (streamOnly) {
    return [...projector, ...monitor, ...reorderedVisible];
  }

  return [
    ...reorderedVisible.filter((q) => q.displayType === "projector"),
    ...reorderedVisible.filter((q) => q.displayType === "monitor"),
    ...reorderedVisible.filter((q) => q.displayType === "stream"),
  ];
};
