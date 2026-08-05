import { richTextToPlainText } from "../../types/richText";
import {
  getServicePlanElementAssignees,
  getServicePlanElementScriptureRefs,
  getServicePlanElementSongRefs,
} from "../../types/servicePlan";
import type {
  ServicePlanAssignee,
  ServicePlanElement,
  ServicePlanSection,
  ServicePlanTeamNote,
} from "../../types/servicePlan";

export type ServicePlanningRefreshOptions = {
  updateTitles: boolean;
  updateAssignments: boolean;
  updateTiming: boolean;
  updateNotes: boolean;
  addMissing: boolean;
  removeMissing: boolean;
  /** Legacy imports predate source markers. This opt-in is only used when the
   * operator explicitly asks to remove items absent from the source. */
  treatUnmarkedItemsAsSource?: boolean;
};

export const DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS: ServicePlanningRefreshOptions =
  {
    updateTitles: true,
    updateAssignments: true,
    updateTiming: true,
    updateNotes: true,
    addMissing: true,
    removeMissing: false,
  };

type Indexed<T> = { value: T; index: number };

const normalized = (value: string): string =>
  value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

/**
 * Pairs unchanged labels first, then uses remaining source order.
 *
 * Both passes are gated, and separately: an operator's own item must not be
 * consumed by a source row in either one, or a refresh silently rewrites work
 * the source never owned. Order is the weaker evidence of the two, so it is
 * gated more tightly than a matching title.
 */
const pairByLabelThenOrder = <T>(
  current: T[],
  imported: T[],
  label: (item: T) => string,
  canPairByLabel: (item: T) => boolean = () => true,
  canPairByOrder: (item: T) => boolean = () => true,
): Array<[Indexed<T>, Indexed<T>]> => {
  const availableCurrent = current.map((value, index) => ({ value, index }));
  const availableImported = imported.map((value, index) => ({ value, index }));
  const pairs: Array<[Indexed<T>, Indexed<T>]> = [];
  const usedCurrent = new Set<number>();
  const usedImported = new Set<number>();

  for (const incoming of availableImported) {
    const candidate = availableCurrent.find(
      (existing) =>
        !usedCurrent.has(existing.index) &&
        canPairByLabel(existing.value) &&
        normalized(label(existing.value)) === normalized(label(incoming.value)),
    );
    if (!candidate) continue;
    usedCurrent.add(candidate.index);
    usedImported.add(incoming.index);
    pairs.push([candidate, incoming]);
  }

  const remainingCurrent = availableCurrent.filter(
    (item) => !usedCurrent.has(item.index) && canPairByOrder(item.value),
  );
  const remainingImported = availableImported.filter(
    (item) => !usedImported.has(item.index),
  );
  const count = Math.min(remainingCurrent.length, remainingImported.length);
  for (let index = 0; index < count; index += 1) {
    pairs.push([remainingCurrent[index], remainingImported[index]]);
  }
  return pairs;
};

/**
 * Take the source's people while keeping the operator's microphone plan.
 *
 * Microphones live on assignees, so replacing the list outright would delete
 * the mic assignments on every refresh — the very thing "Assigned to" updates
 * must not touch. Local microphones follow the person by name when the source
 * reorders them; unmatched slots still fall back to position so a rename keeps
 * the mic. Any local slot the source does not name survives as an unassigned
 * one so its microphones are never dropped.
 */
export const mergeImportedAssignees = (
  current: ServicePlanElement,
  imported: ServicePlanElement,
): ServicePlanAssignee[] => {
  const currentAssignees = getServicePlanElementAssignees(current);
  const importedAssignees = getServicePlanElementAssignees(imported);
  /** Strip the person, keep whatever they were carrying. */
  const asUnassigned = (
    assignee: ServicePlanAssignee,
  ): ServicePlanAssignee => ({
    id: assignee.id,
    ...(assignee.microphoneIds?.length
      ? { microphoneIds: assignee.microphoneIds }
      : {}),
  });

  if (!importedAssignees.length) {
    return currentAssignees
      .filter((assignee) => assignee.microphoneIds?.length)
      .map(asUnassigned);
  }

  const pairs = pairByLabelThenOrder(
    currentAssignees,
    importedAssignees,
    (assignee) => assignee.name || "",
    (assignee) => Boolean(assignee.name?.trim()),
  );
  const currentByImportedIndex = new Map(
    pairs.map(([existing, incoming]) => [incoming.index, existing]),
  );
  const pairedCurrentIndexes = new Set(
    pairs.map(([existing]) => existing.index),
  );

  return [
    ...importedAssignees.map((importedAssignee, index) => {
      const existing = currentByImportedIndex.get(index)?.value;
      return {
        id: existing?.id ?? importedAssignee.id,
        ...(importedAssignee.name ? { name: importedAssignee.name } : {}),
        ...(existing?.microphoneIds?.length
          ? { microphoneIds: existing.microphoneIds }
          : {}),
      };
    }),
    ...currentAssignees
      .filter((_, index) => !pairedCurrentIndexes.has(index))
      .filter((assignee) => assignee.microphoneIds?.length)
      .map(asUnassigned),
  ];
};

const copyOptionalField = <T extends object, K extends keyof T>(
  target: T,
  source: T,
  key: K,
): T => {
  const next = { ...target };
  if (source[key] === undefined) delete next[key];
  else next[key] = source[key];
  return next;
};

/**
 * Service Planning parses fresh note IDs each time. Keep the existing ID for
 * a matching team note so a repeated import is a true no-op, not a rewrite of
 * otherwise identical note records.
 */
const preserveImportedTeamNoteIds = (
  currentNotes: ServicePlanTeamNote[],
  importedNotes: ServicePlanTeamNote[],
): ServicePlanTeamNote[] => {
  const available = currentNotes.filter((note) => note.scope !== "role");
  return importedNotes.map((importedNote) => {
    const exactIndex = available.findIndex(
      (currentNote) =>
        currentNote.label === importedNote.label &&
        JSON.stringify(currentNote.note) === JSON.stringify(importedNote.note),
    );
    const labelIndex =
      exactIndex >= 0
        ? exactIndex
        : available.findIndex(
            (currentNote) => currentNote.label === importedNote.label,
          );
    if (labelIndex < 0) return importedNote;
    const [currentNote] = available.splice(labelIndex, 1);
    return { ...importedNote, id: currentNote.id };
  });
};

const mergeElement = (
  current: ServicePlanElement,
  imported: ServicePlanElement,
  options: ServicePlanningRefreshOptions,
): ServicePlanElement => {
  let next: ServicePlanElement = { ...current, sourcePlanningManaged: true };
  if (options.updateTitles) {
    next = {
      ...next,
      type: imported.type,
      title: imported.title,
    };
    // A refresh must not undo song linking: once a slot points at a real
    // library song, an unmatched ("pending") ref from the source is the weaker
    // of the two, so the operator's link stays. Check every song slot — a
    // worship set can keep a later library link even when an earlier one is
    // still pending.
    const currentSongRefs = getServicePlanElementSongRefs(current);
    const importedSongRefs = getServicePlanElementSongRefs(imported);
    const mergedSongRefs = importedSongRefs.map((importedRef, index) => {
      const currentRef = currentSongRefs[index];
      if (currentRef?.kind === "library" && importedRef.kind === "pending") {
        return currentRef;
      }
      return importedRef;
    });
    const songRefsUnchanged =
      mergedSongRefs.length === currentSongRefs.length &&
      mergedSongRefs.every((ref, index) => ref === currentSongRefs[index]);
    if (!songRefsUnchanged) {
      next.songRefs = mergedSongRefs;
      delete next.songRef;
    }
    next.scriptureRefs = getServicePlanElementScriptureRefs(imported);
    delete next.scriptureRef;
    next = copyOptionalField(next, imported, "sourceElementTypeRaw");
  }
  if (options.updateAssignments) {
    next.assignees = mergeImportedAssignees(current, imported);
    next = copyOptionalField(next, imported, "sourceLedByRaw");
  }
  if (options.updateTiming) {
    next = copyOptionalField(next, imported, "startTime");
    next = copyOptionalField(next, imported, "durationSeconds");
    next = copyOptionalField(next, imported, "durationMinutes");
  }
  if (options.updateNotes) {
    next = copyOptionalField(next, imported, "notes");
    // Service Planning can refresh shared and team notes, but role notes are
    // local Teams instructions and must survive that refresh.
    const localRoleNotes = (current.teamNotes || []).filter(
      (note) => note.scope === "role",
    );
    const importedTeamNotes = preserveImportedTeamNoteIds(
      current.teamNotes || [],
      (imported.teamNotes || []).filter((note) => note.scope !== "role"),
    );
    const nextNotes = [...importedTeamNotes, ...localRoleNotes];
    if (nextNotes.length) next.teamNotes = nextNotes;
    else delete next.teamNotes;
  }
  return next;
};

/**
 * Whether this plan records item-level provenance at all.
 *
 * Plans imported before source tracking existed carry none, and a title is the
 * only handle a refresh has on them. On a plan that does track it, an unmarked
 * item is one the operator added by hand — the source has no claim on it.
 */
const planTracksSource = (sections: ServicePlanSection[]): boolean =>
  sections.some(
    (section) =>
      Boolean(section.sourcePlanningManaged) ||
      section.elements.some((element) =>
        Boolean(element.sourcePlanningManaged),
      ),
  );

const managedImportedElement = (
  element: ServicePlanElement,
): ServicePlanElement => ({
  ...element,
  sourcePlanningManaged: true,
});

const managedImportedSection = (
  section: ServicePlanSection,
): ServicePlanSection => ({
  ...section,
  sourcePlanningManaged: true,
  elements: section.elements.map(managedImportedElement),
});

/**
 * Reconciles a fresh Service Planning parse into an editable plan without
 * replacing locally-created IDs, notes, roster links, or outline-push state.
 * It intentionally does not reorder current items; importing source order is
 * a separate operator decision from refreshing source fields.
 */
export const refreshServicePlanFromImport = (
  currentSections: ServicePlanSection[],
  importedSections: ServicePlanSection[],
  options: ServicePlanningRefreshOptions,
): ServicePlanSection[] => {
  const tracksSource = planTracksSource(currentSections);
  /**
   * A matching title is strong evidence, so it may also refresh an unmarked
   * item — but only on a legacy plan, where nothing is marked and a title is
   * all there is to go on. On a tracked plan an unmarked item is the
   * operator's, and a source row with the same title must not consume it.
   */
  const canPairByLabel = (item: { sourcePlanningManaged?: boolean }): boolean =>
    Boolean(item.sourcePlanningManaged) || !tracksSource;
  /**
   * Position alone is weak evidence, and the same predicate decides removal:
   * only items the source demonstrably owns can be rewritten by order or
   * dropped for being absent.
   */
  const isSourceOwned = (item: { sourcePlanningManaged?: boolean }): boolean =>
    Boolean(item.sourcePlanningManaged) ||
    (!tracksSource && Boolean(options.treatUnmarkedItemsAsSource));

  const sectionPairs = pairByLabelThenOrder(
    currentSections,
    importedSections,
    (section) => section.name,
    canPairByLabel,
    isSourceOwned,
  );
  const importedByCurrentIndex = new Map(
    sectionPairs.map(([current, imported]) => [current.index, imported]),
  );
  const pairedImportedSections = new Set(
    sectionPairs.map(([, imported]) => imported.index),
  );

  const refreshed = currentSections.flatMap(
    (currentSection, currentSectionIndex) => {
      const importedSection = importedByCurrentIndex.get(currentSectionIndex);
      if (!importedSection) {
        return options.removeMissing && currentSection.sourcePlanningManaged
          ? []
          : [currentSection];
      }

      const sourceSection = importedSection.value;
      const elementPairs = pairByLabelThenOrder(
        currentSection.elements,
        sourceSection.elements,
        (element) => richTextToPlainText(element.title),
        canPairByLabel,
        isSourceOwned,
      );
      const importedByCurrentElementIndex = new Map(
        elementPairs.map(([current, imported]) => [current.index, imported]),
      );
      const pairedImportedElements = new Set(
        elementPairs.map(([, imported]) => imported.index),
      );
      const elements = currentSection.elements.flatMap(
        (currentElement, currentElementIndex) => {
          const importedElement =
            importedByCurrentElementIndex.get(currentElementIndex);
          if (importedElement)
            return [
              mergeElement(currentElement, importedElement.value, options),
            ];
          return options.removeMissing && isSourceOwned(currentElement)
            ? []
            : [currentElement];
        },
      );

      if (options.addMissing) {
        for (const importedElement of sourceSection.elements) {
          const sourceIndex = sourceSection.elements.indexOf(importedElement);
          if (!pairedImportedElements.has(sourceIndex))
            elements.push(managedImportedElement(importedElement));
        }
      }

      if (
        options.removeMissing &&
        currentSection.sourcePlanningManaged &&
        elements.length === 0
      ) {
        return [];
      }
      return [
        {
          ...currentSection,
          sourcePlanningManaged: true,
          name: options.updateTitles ? sourceSection.name : currentSection.name,
          elements,
        },
      ];
    },
  );

  if (options.addMissing) {
    for (const importedSection of importedSections) {
      const sourceIndex = importedSections.indexOf(importedSection);
      if (!pairedImportedSections.has(sourceIndex))
        refreshed.push(managedImportedSection(importedSection));
    }
  }
  return refreshed;
};
