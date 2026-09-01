import type { ServicePlanSection } from "../../types/servicePlan";

/**
 * Inserts consecutive runs of new source sections beside the closest section
 * that was confidently matched. Existing sections never change relative order.
 */
export const insertNewServicePlanSectionRuns = (
  currentSections: ServicePlanSection[],
  sourceSectionCount: number,
  newSectionBySourceIndex: ReadonlyMap<number, ServicePlanSection>,
  currentSectionIdBySourceIndex: ReadonlyMap<number, string>,
): ServicePlanSection[] => {
  const result = [...currentSections];
  let sourceIndex = 0;

  while (sourceIndex < sourceSectionCount) {
    if (!newSectionBySourceIndex.has(sourceIndex)) {
      sourceIndex += 1;
      continue;
    }

    const firstRunIndex = sourceIndex;
    const newSections: ServicePlanSection[] = [];
    while (sourceIndex < sourceSectionCount) {
      const newSection = newSectionBySourceIndex.get(sourceIndex);
      if (!newSection) break;
      newSections.push(newSection);
      sourceIndex += 1;
    }

    let insertionIndex = -1;
    for (
      let nextIndex = sourceIndex;
      nextIndex < sourceSectionCount;
      nextIndex += 1
    ) {
      const anchorId = currentSectionIdBySourceIndex.get(nextIndex);
      if (!anchorId) continue;
      insertionIndex = result.findIndex((section) => section.id === anchorId);
      if (insertionIndex >= 0) break;
    }
    if (insertionIndex < 0) {
      for (
        let previousIndex = firstRunIndex - 1;
        previousIndex >= 0;
        previousIndex -= 1
      ) {
        const anchorId = currentSectionIdBySourceIndex.get(previousIndex);
        if (!anchorId) continue;
        const anchorIndex = result.findIndex((section) => section.id === anchorId);
        if (anchorIndex < 0) continue;
        insertionIndex = anchorIndex + 1;
        break;
      }
    }
    result.splice(
      insertionIndex < 0 ? result.length : insertionIndex,
      0,
      ...newSections,
    );
  }

  return result;
};
