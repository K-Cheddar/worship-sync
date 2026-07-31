import { richTextToPlainText } from "../../types/richText";
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
  kind: ServicePlanImportChangeKind;
  itemName: string;
  sectionName: string;
  fields: ServicePlanImportFieldChange[];
};

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
  if (!element.songRef) return "No song";
  return element.songRef.kind === "library"
    ? element.songRef.songName
    : element.songRef.title;
};

const formatScripture = (element: ServicePlanElement) =>
  element.scriptureRef?.label || "No scripture";

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
  if (!serializesEqual(current.songRef, next.songRef)) {
    fields.push({
      label: "Song",
      before: formatSong(current),
      after: formatSong(next),
    });
  }
  if (!serializesEqual(current.scriptureRef, next.scriptureRef)) {
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
  if (
    current.assignedName !== next.assignedName ||
    current.sourceLedByRaw !== next.sourceLedByRaw
  ) {
    fields.push({
      label: "Assigned to",
      before: optionalValue(current.assignedName, "Unassigned"),
      after: optionalValue(next.assignedName, "Unassigned"),
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
    { element: ServicePlanElement; sectionName: string }
  >();
  const nextItems = new Map<
    string,
    { element: ServicePlanElement; sectionName: string }
  >();

  currentSections.forEach((section) => {
    section.elements.forEach((element) => {
      currentItems.set(element.id, { element, sectionName: section.name });
    });
  });
  nextSections.forEach((section) => {
    section.elements.forEach((element) => {
      nextItems.set(element.id, { element, sectionName: section.name });
    });
  });

  const changes: ServicePlanImportChange[] = [];
  nextItems.forEach(({ element, sectionName }, id) => {
    const current = currentItems.get(id);
    if (!current) {
      changes.push({
        id,
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
        kind: "updated",
        itemName: itemName(element),
        sectionName,
        fields,
      });
    }
  });
  currentItems.forEach(({ element, sectionName }, id) => {
    if (nextItems.has(id)) return;
    changes.push({
      id,
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
