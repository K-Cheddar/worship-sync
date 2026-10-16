import type { ServicePlanElement, ServicePlanSection } from "../../types/servicePlan";

/** Place only imported additions/moves around confidently matched source rows.
 * Unmatched operator items keep their relative order and are never used as
 * positional evidence. */
export const placeServicePlanImportElements = (
  existingElements: ServicePlanElement[],
  sourceOrder: ServicePlanElement[],
  elementsToPlace: ServicePlanElement[],
): ServicePlanElement[] => {
  const placementIds = new Set(elementsToPlace.map(({ id }) => id));
  const result = existingElements.filter(({ id }) => !placementIds.has(id));
  const sourceIndex = new Map(sourceOrder.map(({ id }, index) => [id, index]));
  const orderedPlacements = elementsToPlace
    .map((element) => ({ element, index: sourceIndex.get(element.id) ?? Number.MAX_SAFE_INTEGER }))
    .sort((left, right) => left.index - right.index);

  orderedPlacements.forEach(({ element, index }) => {
    if (!sourceOrder.length || index === Number.MAX_SAFE_INTEGER) {
      result.push(element);
      return;
    }
    let before = result.findIndex((candidate) => (sourceIndex.get(candidate.id) ?? -1) > index);
    if (before < 0) {
      const previousIndexes = result.flatMap((candidate, candidateIndex) => {
        const position = sourceIndex.get(candidate.id);
        return position !== undefined && position < index ? [candidateIndex] : [];
      });
      before = previousIndexes.length ? previousIndexes.at(-1)! + 1 : result.length;
    }
    result.splice(before, 0, element);
  });
  return result;
};

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
