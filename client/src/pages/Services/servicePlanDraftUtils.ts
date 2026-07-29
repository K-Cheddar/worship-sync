import generateRandomId from "../../utils/generateRandomId";
import { EMPTY_RICH_TEXT } from "../../types/richText";
import { getServicePlanElementType } from "../../types/servicePlan";
import type {
  ServicePlanElement,
  ServicePlanElementType,
  ServicePlanSection,
} from "../../types/servicePlan";

export const createEmptyServicePlanElement = (
  type: ServicePlanElementType = "free",
): ServicePlanElement => ({
  id: generateRandomId(),
  type,
  title: EMPTY_RICH_TEXT,
});

export const createEmptyServicePlanSection = (
  name = "New section",
): ServicePlanSection => ({
  id: generateRandomId(),
  name,
  elements: [],
});

/** Seed sections for a brand-new, build-from-scratch plan. */
export const createEmptyServicePlanSections = (): ServicePlanSection[] => [
  createEmptyServicePlanSection("Service"),
];

export const addSection = (
  sections: ServicePlanSection[],
  name = "New section",
): ServicePlanSection[] => [...sections, createEmptyServicePlanSection(name)];

export const removeSection = (
  sections: ServicePlanSection[],
  sectionId: string,
): ServicePlanSection[] =>
  sections.filter((section) => section.id !== sectionId);

export const renameSection = (
  sections: ServicePlanSection[],
  sectionId: string,
  name: string,
): ServicePlanSection[] =>
  sections.map((section) =>
    section.id === sectionId ? { ...section, name } : section,
  );

export const reorderSections = (
  sections: ServicePlanSection[],
  orderedSectionIds: string[],
): ServicePlanSection[] => {
  const byId = new Map(sections.map((section) => [section.id, section]));
  return orderedSectionIds
    .map((id) => byId.get(id))
    .filter((section): section is ServicePlanSection => Boolean(section));
};

export const addElement = (
  sections: ServicePlanSection[],
  sectionId: string,
  type: ServicePlanElementType = "free",
): ServicePlanSection[] =>
  sections.map((section) =>
    section.id === sectionId
      ? {
          ...section,
          elements: [...section.elements, createEmptyServicePlanElement(type)],
        }
      : section,
  );

export const removeElement = (
  sections: ServicePlanSection[],
  sectionId: string,
  elementId: string,
): ServicePlanSection[] =>
  sections.map((section) =>
    section.id === sectionId
      ? {
          ...section,
          elements: section.elements.filter(
            (element) => element.id !== elementId,
          ),
        }
      : section,
  );

export const updateElement = (
  sections: ServicePlanSection[],
  sectionId: string,
  elementId: string,
  changes: Partial<ServicePlanElement>,
): ServicePlanSection[] =>
  sections.map((section) =>
    section.id === sectionId
      ? {
          ...section,
          elements: section.elements.map((element) => {
            if (element.id !== elementId) return element;
            const next = { ...element, ...changes };
            // Kind follows the attachments rather than an operator-picked
            // type, so attaching/removing a song or scripture keeps the
            // stored `type` (which the outline bridge reads) correct.
            return { ...next, type: getServicePlanElementType(next) };
          }),
        }
      : section,
  );

export const reorderElementsInSection = (
  sections: ServicePlanSection[],
  sectionId: string,
  orderedElementIds: string[],
): ServicePlanSection[] =>
  sections.map((section) => {
    if (section.id !== sectionId) return section;
    const byId = new Map(
      section.elements.map((element) => [element.id, element]),
    );
    return {
      ...section,
      elements: orderedElementIds
        .map((id) => byId.get(id))
        .filter((element): element is ServicePlanElement => Boolean(element)),
    };
  });

/**
 * Reduce a plan's sections to a reusable skeleton, and re-key it. Used both
 * when saving a plan as a template and when applying one back onto a plan, so
 * neither direction can leak one week's specifics into another.
 *
 * Kept: structure, section/item names, timings, notes, team notes.
 * Cleared: song/scripture picks, who's assigned, and the live-outline push
 * pointer — all of which belong to a single dated service, not to the pattern.
 * Ids are regenerated so two plans built from one template never collide.
 */
export const cloneSectionsForTemplate = (
  sections: ServicePlanSection[],
): ServicePlanSection[] =>
  sections.map((section) => ({
    ...section,
    id: generateRandomId(),
    elements: section.elements.map((element) => {
      const cloned = {
        ...element,
        id: generateRandomId(),
        songRef: undefined,
        scriptureRef: undefined,
        assignedName: undefined,
        assignedMemberId: undefined,
        sourceLedByRaw: undefined,
        pushedOutlineListId: undefined,
      };
      // Kind follows the (now-cleared) attachments.
      return { ...cloned, type: getServicePlanElementType(cloned) };
    }),
  }));

/** Move an element to a different section, appending it at the end. No-op if
 * the element or either section can't be found, or source === target. */
export const moveElementToSection = (
  sections: ServicePlanSection[],
  elementId: string,
  fromSectionId: string,
  toSectionId: string,
): ServicePlanSection[] => {
  if (fromSectionId === toSectionId) return sections;
  const fromSection = sections.find((section) => section.id === fromSectionId);
  const element = fromSection?.elements.find((item) => item.id === elementId);
  if (!element) return sections;
  return sections.map((section) => {
    if (section.id === fromSectionId) {
      return {
        ...section,
        elements: section.elements.filter((item) => item.id !== elementId),
      };
    }
    if (section.id === toSectionId) {
      return { ...section, elements: [...section.elements, element] };
    }
    return section;
  });
};
