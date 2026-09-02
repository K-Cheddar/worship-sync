import generateRandomId from "../../utils/generateRandomId";
import { EMPTY_RICH_TEXT, richTextToPlainText } from "../../types/richText";
import { cleanPlanningTitle } from "../../integrations/servicePlanning/cleanPlanningTitle";
import {
  getServicePlanElementAssignees,
  getServicePlanElementType,
  getServicePlanElementSongRefs,
} from "../../types/servicePlan";
import type {
  ServicePlanElement,
  ServicePlanElementType,
  ServicePlanSection,
  ServicePlanSongReference,
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
  insertAfterSectionId?: string,
): ServicePlanSection[] => {
  const newSection = createEmptyServicePlanSection(name);
  if (!insertAfterSectionId) return [...sections, newSection];
  const insertAfterIndex = sections.findIndex(
    (section) => section.id === insertAfterSectionId,
  );
  if (insertAfterIndex === -1) return [...sections, newSection];
  return [
    ...sections.slice(0, insertAfterIndex + 1),
    newSection,
    ...sections.slice(insertAfterIndex + 1),
  ];
};

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
  insertAfterElementId?: string,
): ServicePlanSection[] =>
  sections.map((section) =>
    section.id === sectionId
      ? {
          ...section,
          elements: (() => {
            const nextElement = createEmptyServicePlanElement(type);
            const insertAfterIndex = insertAfterElementId
              ? section.elements.findIndex((element) => element.id === insertAfterElementId)
              : -1;
            if (insertAfterIndex === -1) {
              return [...section.elements, nextElement];
            }
            return [
              ...section.elements.slice(0, insertAfterIndex + 1),
              nextElement,
              ...section.elements.slice(insertAfterIndex + 1),
            ];
          })(),
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

type PendingSongReference = Extract<
  ServicePlanSongReference,
  { kind: "pending" }
>;
type LibrarySongReference = Extract<
  ServicePlanSongReference,
  { kind: "library" }
>;

/**
 * Replaces every occurrence of the exact pending reference that was created.
 * Matching both title and stored lyrics avoids linking unrelated same-title
 * songs while keeping a repeated/continued song consistent across the plan.
 */
export const replaceMatchingPendingSongReferences = (
  sections: ServicePlanSection[],
  target: PendingSongReference,
  replacement: LibrarySongReference,
): ServicePlanSection[] =>
  sections.map((section) => {
    let sectionChanged = false;
    const elements = section.elements.map((element) => {
      const songRefs = getServicePlanElementSongRefs(element);
      const hasImplicitSongReference =
        !element.sourceSongReferenceDismissed &&
        !songRefs.length &&
        (element.type === "song" ||
          /\b(song|hymn|chorus|anthem)\b/i.test(element.sourceElementTypeRaw || "")) &&
        cleanPlanningTitle(richTextToPlainText(element.title)) === target.title;
      let changed = false;
      const nextSongRefs = songRefs.map((songRef) => {
        const matches =
          songRef.kind === "pending" &&
          songRef.title === target.title &&
          songRef.lyricsText === target.lyricsText;
        if (!matches) return songRef;
        changed = true;
        return replacement;
      });
      if (hasImplicitSongReference) {
        changed = true;
        nextSongRefs.push(replacement);
      }
      if (!changed) return element;
      sectionChanged = true;
      const next = {
        ...element,
        songRef: undefined,
        songRefs: nextSongRefs,
      };
      return { ...next, type: getServicePlanElementType(next) };
    });
    return sectionChanged ? { ...section, elements } : section;
  });

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
 * Plan → template. Reduce a dated plan's sections to a reusable skeleton and
 * re-key it, so this week's specifics cannot leak into the pattern.
 *
 * Kept: structure, section/item names, timings, notes, team notes, and the
 * microphone plan. Microphones are church-owned and addressed to roles by
 * their own configuration rather than by whoever holds them, so a mic plan
 * repeats week to week and belongs to the pattern. Each assignee is kept as
 * the microphone slot it describes, with the person removed.
 * Cleared: song/scripture picks, who's assigned, and the live-outline push
 * pointer — all of which belong to a single dated service, not to the pattern.
 * Ids are regenerated so two plans built from one template never collide.
 *
 * Every name goes, including standing ones like "Audience": a plan's assignees
 * are this week's people and nothing here can tell a group apart from a
 * person. Standing labels are typed once in the template editor instead — see
 * cloneSectionsFromTemplate for the direction that preserves them.
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
        songRefs: undefined,
        scriptureRef: undefined,
        scriptureRefs: undefined,
        // The people go, the microphone plan stays: each assignee is kept as
        // the microphone slot it describes, and gains a name back when the
        // template is applied to a date. Slots holding nothing are dropped.
        assignees: getServicePlanElementAssignees(element)
          .filter((assignee) => assignee.microphoneIds?.length)
          .map((assignee) => ({
            id: generateRandomId(),
            microphoneIds: [...(assignee.microphoneIds || [])],
          })),
        assignedName: undefined,
        assignedMemberId: undefined,
        microphoneAssignments: undefined,
        sourceLedByRaw: undefined,
        pushedOutlineListId: undefined,
        pushedOutlineListIds: undefined,
        // Scheduled role links are reusable template structure, unlike the
        // dated people assignments above.
        scheduledPositionIds: element.scheduledPositionIds
          ? [...element.scheduledPositionIds]
          : undefined,
      };
      // Kind follows the (now-cleared) attachments.
      return { ...cloned, type: getServicePlanElementType(cloned) };
    }),
  }));

/**
 * Template → plan (and template → duplicate). Re-key the sections without
 * stripping anything the template deliberately holds.
 *
 * A template's assignees are standing labels, not people — "Audience",
 * "Chorale", the group that always carries a given microphone. Running the
 * save-direction clone here instead would erase them on the way out, so a
 * template could never express an audience mic at all.
 */
export const cloneSectionsFromTemplate = (
  sections: ServicePlanSection[],
): ServicePlanSection[] =>
  sections.map((section) => ({
    ...section,
    id: generateRandomId(),
    elements: section.elements.map((element) => ({
      ...element,
      id: generateRandomId(),
      assignees: getServicePlanElementAssignees(element).map((assignee) => ({
        ...assignee,
        id: generateRandomId(),
      })),
    })),
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

/** Move one item to an indexed position, including across sections. */
export const moveElementToPosition = (
  sections: ServicePlanSection[],
  elementId: string,
  fromSectionId: string,
  toSectionId: string,
  targetIndex: number,
): ServicePlanSection[] => {
  const source = sections.find((section) => section.id === fromSectionId);
  const target = sections.find((section) => section.id === toSectionId);
  const element = source?.elements.find((item) => item.id === elementId);
  if (!source || !target || !element) return sections;
  const remaining = source.elements.filter((item) => item.id !== elementId);
  const targetElements = fromSectionId === toSectionId ? remaining : target.elements;
  const boundedIndex = Math.max(0, Math.min(targetIndex, targetElements.length));
  const nextTargetElements = [
    ...targetElements.slice(0, boundedIndex),
    element,
    ...targetElements.slice(boundedIndex),
  ];
  return sections.map((section) => {
    if (section.id === fromSectionId && section.id === toSectionId) {
      return { ...section, elements: nextTargetElements };
    }
    if (section.id === fromSectionId) return { ...section, elements: remaining };
    if (section.id === toSectionId) return { ...section, elements: nextTargetElements };
    return section;
  });
};
