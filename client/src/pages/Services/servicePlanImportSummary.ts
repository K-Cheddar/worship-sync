import { richTextToPlainText } from "../../types/richText";
import {
  getServicePlanElementAssigneeNames,
  getServicePlanElementScriptureRefs,
  getServicePlanElementSongRefs,
} from "../../types/servicePlan";
import type {
  ServicePlanElement,
  ServicePlanSection,
} from "../../types/servicePlan";

export type ServicePlanImportChangeKind = "added" | "removed" | "updated";

export type ServicePlanImportFieldChange = {
  label: string;
  before: string;
  after: string;
};

export type ServicePlanImportChange = {
  id: string;
  sectionId: string;
  kind: ServicePlanImportChangeKind;
  itemName: string;
  sectionName: string;
  fields: ServicePlanImportFieldChange[];
};

/** Stable key for a review checkbox. */
export const servicePlanImportChangeKey = (change: ServicePlanImportChange): string =>
  `${change.kind}:${change.id}`;

export type ServicePlanImportSummary = {
  changes: ServicePlanImportChange[];
  added: number;
  removed: number;
  updated: number;
};

const itemName = (element: ServicePlanElement) =>
  richTextToPlainText(element.title).trim() || "Untitled item";

const serializesEqual = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

const comparableTeamNotes = (element: ServicePlanElement) =>
  (element.teamNotes || [])
    .map(({ id: _id, ...note }) => note)
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );

const optionalValue = (value: string | undefined, emptyLabel: string) =>
  value?.trim() || emptyLabel;

const formatDuration = (element: ServicePlanElement) => {
  const seconds =
    element.durationSeconds ??
    (typeof element.durationMinutes === "number"
      ? element.durationMinutes * 60
      : 0);
  if (!seconds) return "No duration";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  if (!minutes) return `${remainder}s`;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
};

const formatTiming = (element: ServicePlanElement) =>
  `${optionalValue(element.startTime, "No start time")} · ${formatDuration(element)}`;

const formatNotes = (element: ServicePlanElement) => {
  const values = [
    ...(richTextToPlainText(element.notes).trim()
      ? [`Shared: ${richTextToPlainText(element.notes).trim()}`]
      : []),
    ...(element.teamNotes || [])
      .map((note) => {
        const text = richTextToPlainText(note.note).trim();
        return text ? `${note.label}: ${text}` : "";
      })
      .filter(Boolean),
  ];
  return values.join(" · ") || "No notes";
};

const formatSong = (element: ServicePlanElement) => {
  const refs = getServicePlanElementSongRefs(element);
  if (!refs.length) return "No song";
  return refs.map((songRef) =>
    songRef.kind === "library" ? songRef.songName : songRef.title,
  ).join(", ");
};

const formatScripture = (element: ServicePlanElement) =>
  getServicePlanElementScriptureRefs(element)
    .map((scriptureRef) => scriptureRef.label)
    .join(", ") || "No scripture";

const changedFields = (
  current: ServicePlanElement,
  next: ServicePlanElement,
): ServicePlanImportFieldChange[] => {
  const fields: ServicePlanImportFieldChange[] = [];
  if (!serializesEqual(current.title, next.title)) {
    fields.push({
      label: "Title",
      before: itemName(current),
      after: itemName(next),
    });
  }
  if (!serializesEqual(
    getServicePlanElementSongRefs(current),
    getServicePlanElementSongRefs(next),
  )) {
    fields.push({
      label: "Song",
      before: formatSong(current),
      after: formatSong(next),
    });
  }
  if (!serializesEqual(
    getServicePlanElementScriptureRefs(current),
    getServicePlanElementScriptureRefs(next),
  )) {
    fields.push({
      label: "Scripture",
      before: formatScripture(current),
      after: formatScripture(next),
    });
  }
  if (current.sourceElementTypeRaw !== next.sourceElementTypeRaw) {
    fields.push({
      label: "Source type",
      before: optionalValue(current.sourceElementTypeRaw, "None"),
      after: optionalValue(next.sourceElementTypeRaw, "None"),
    });
  }
  const currentAssignees = getServicePlanElementAssigneeNames(current).join(", ");
  const nextAssignees = getServicePlanElementAssigneeNames(next).join(", ");
  if (
    currentAssignees !== nextAssignees ||
    current.sourceLedByRaw !== next.sourceLedByRaw
  ) {
    fields.push({
      label: "Assigned to",
      before: optionalValue(currentAssignees, "Unassigned"),
      after: optionalValue(nextAssignees, "Unassigned"),
    });
  }
  if (
    current.startTime !== next.startTime ||
    current.durationSeconds !== next.durationSeconds ||
    current.durationMinutes !== next.durationMinutes
  ) {
    fields.push({
      label: "Time or duration",
      before: formatTiming(current),
      after: formatTiming(next),
    });
  }
  if (
    !serializesEqual(current.notes, next.notes) ||
    !serializesEqual(comparableTeamNotes(current), comparableTeamNotes(next))
  ) {
    fields.push({
      label: "Notes",
      before: formatNotes(current),
      after: formatNotes(next),
    });
  }
  return fields;
};

/** Describes the user-visible result of a selected Service Planning refresh. */
export const summarizeServicePlanImport = (
  currentSections: ServicePlanSection[],
  nextSections: ServicePlanSection[],
): ServicePlanImportSummary => {
  const currentItems = new Map<
    string,
    { element: ServicePlanElement; sectionId: string; sectionName: string }
  >();
  const nextItems = new Map<
    string,
    { element: ServicePlanElement; sectionId: string; sectionName: string }
  >();

  currentSections.forEach((section) => {
    section.elements.forEach((element) => {
      currentItems.set(element.id, {
        element,
        sectionId: section.id,
        sectionName: section.name,
      });
    });
  });
  nextSections.forEach((section) => {
    section.elements.forEach((element) => {
      nextItems.set(element.id, {
        element,
        sectionId: section.id,
        sectionName: section.name,
      });
    });
  });

  const changes: ServicePlanImportChange[] = [];
  nextItems.forEach(({ element, sectionId, sectionName }, id) => {
    const current = currentItems.get(id);
    if (!current) {
      changes.push({
        id,
        sectionId,
        kind: "added",
        itemName: itemName(element),
        sectionName,
        fields: [],
      });
      return;
    }
    const fields = changedFields(current.element, element);
    if (fields.length) {
      changes.push({
        id,
        sectionId,
        kind: "updated",
        itemName: itemName(element),
        sectionName,
        fields,
      });
    }
  });
  currentItems.forEach(({ element, sectionId, sectionName }, id) => {
    if (nextItems.has(id)) return;
    changes.push({
      id,
      sectionId,
      kind: "removed",
      itemName: itemName(element),
      sectionName,
      fields: [],
    });
  });

  changes.sort((left, right) => {
    const section = left.sectionName.localeCompare(right.sectionName);
    if (section) return section;
    return left.itemName.localeCompare(right.itemName);
  });
  return {
    changes,
    added: changes.filter((change) => change.kind === "added").length,
    removed: changes.filter((change) => change.kind === "removed").length,
    updated: changes.filter((change) => change.kind === "updated").length,
  };
};

/**
 * Applies only the checked changes from a reviewed refresh. This deliberately
 * starts with the current draft so a skipped item keeps every local field.
 */
export const applySelectedServicePlanImportChanges = (
  currentSections: ServicePlanSection[],
  nextSections: ServicePlanSection[],
  summary: ServicePlanImportSummary,
  selectedChangeKeys: ReadonlySet<string>,
): ServicePlanSection[] => {
  const selectedChanges = new Map(
    summary.changes
      .filter((change) => selectedChangeKeys.has(servicePlanImportChangeKey(change)))
      .map((change) => [servicePlanImportChangeKey(change), change]),
  );
  const currentSectionIds = new Set(currentSections.map((section) => section.id));
  const nextSectionsById = new Map(nextSections.map((section) => [section.id, section]));
  const nextItemsById = new Map(
    nextSections.flatMap((section) =>
      section.elements.map((element) => [element.id, element] as const),
    ),
  );

  const selectedChangeFor = (kind: ServicePlanImportChangeKind, id: string) =>
    selectedChanges.get(`${kind}:${id}`);

  const result = currentSections.flatMap((currentSection) => {
    const nextSection = nextSectionsById.get(currentSection.id);
    const sectionChangeKeys = summary.changes
      .filter((change) => change.sectionId === currentSection.id)
      .map(servicePlanImportChangeKey);
    const selectedChangesInSection = [...selectedChanges.values()]
      .filter((change) => change.sectionId === currentSection.id);
    const selectedAdditions = nextSection?.elements.filter((element) =>
      Boolean(selectedChangeFor("added", element.id)),
    ) || [];
    const elements = currentSection.elements.flatMap((currentElement) => {
      if (selectedChangeFor("removed", currentElement.id)) return [];
      if (selectedChangeFor("updated", currentElement.id)) {
        return [nextItemsById.get(currentElement.id) || currentElement];
      }
      return [currentElement];
    });
    elements.push(...selectedAdditions);

    const allElementsRemoved =
      !nextSection &&
      currentSection.elements.length > 0 &&
      currentSection.elements.every((element) =>
        Boolean(selectedChangeFor("removed", element.id)),
      );
    if (allElementsRemoved && currentSection.sourcePlanningManaged) return [];

    return [{
      ...currentSection,
      ...(nextSection && sectionChangeKeys.length && sectionChangeKeys.every((key) =>
        selectedChangeKeys.has(key),
      )
        ? { name: nextSection.name }
        : {}),
      ...(selectedChangesInSection.length && nextSection?.sourcePlanningManaged
        ? { sourcePlanningManaged: true }
        : {}),
      elements,
    }];
  });

  nextSections.forEach((nextSection) => {
    if (currentSectionIds.has(nextSection.id)) return;
    const elements = nextSection.elements.filter((element) =>
      Boolean(selectedChangeFor("added", element.id)),
    );
    if (elements.length) result.push({ ...nextSection, elements });
  });

  return result;
};
