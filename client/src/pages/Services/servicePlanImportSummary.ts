import {
  normalizeRichTextDocument,
  richTextSemanticEqual,
  richTextSemanticValue,
  richTextToPlainText,
} from "../../types/richText";
import {
  getServicePlanElementAssignees,
  getServicePlanElementAssigneeNames,
  getServicePlanElementScriptureRefs,
  getServicePlanElementSongRefs,
} from "../../types/servicePlan";
import type {
  ServicePlanElement,
  ServicePlanSection,
} from "../../types/servicePlan";
import { insertNewServicePlanSectionRuns } from "./servicePlanImportSectionPlacement";

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

const normalizedText = (value: string | undefined) =>
  (value || "").replace(/\r\n?/g, "\n").trim().replace(/\s+/g, " ");

const normalizedLyrics = (value: string) =>
  value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).join("\n").trim();

const normalizedStartTime = (value: string | undefined) => {
  const time = normalizedText(value);
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return time;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
};

const richTextValue = (value: ServicePlanElement["notes"]) =>
  richTextSemanticValue(value);

const richTextEqual = (
  left: ServicePlanElement["notes"],
  right: ServicePlanElement["notes"],
) => richTextSemanticEqual(left, right);

const songRefValue = (ref: ReturnType<typeof getServicePlanElementSongRefs>[number]) =>
  ref.kind === "library"
    ? ["library", ref.songId, normalizedText(ref.songName).toLocaleLowerCase(), normalizedText(ref.key).toLocaleUpperCase()]
    : ["pending", normalizedText(ref.title).toLocaleLowerCase(), normalizedLyrics(ref.lyricsText), normalizedText(ref.key).toLocaleUpperCase()];

const songsEqual = (
  left: ReturnType<typeof getServicePlanElementSongRefs>,
  right: ReturnType<typeof getServicePlanElementSongRefs>,
) => JSON.stringify(left.map(songRefValue)) === JSON.stringify(right.map(songRefValue));

const scriptureValue = (ref: ReturnType<typeof getServicePlanElementScriptureRefs>[number]) =>
  [normalizedText(ref.book).toLocaleLowerCase(), normalizedText(ref.chapter),
    normalizedText(ref.verseRange), normalizedText(ref.version).toLocaleLowerCase()];

const scripturesEqual = (
  left: ReturnType<typeof getServicePlanElementScriptureRefs>,
  right: ReturnType<typeof getServicePlanElementScriptureRefs>,
) => JSON.stringify(left.map(scriptureValue)) === JSON.stringify(right.map(scriptureValue));

const comparableInterpretation = (element: ServicePlanElement) => {
  const ambiguity = element.importAmbiguity;
  if (!ambiguity) return null;
  return {
    status: ambiguity.status,
    authorizationPending: Boolean(ambiguity.authorizationPending),
    reasons: ambiguity.reasons.map(normalizedText),
    songMappings: (ambiguity.songMappings || []).map(({ incoming, candidateOccurrenceIds, sourceFingerprint }) => ({
      incoming: songRefValue(incoming),
      candidateOccurrenceIds: [...candidateOccurrenceIds].sort(),
      sourceFingerprint,
    })),
    parts: ambiguity.parts.map(({ kind, value, destination, sourceField, managed }) => ({
      kind,
      value: normalizedText(value),
      destination,
      sourceField: sourceField || "title",
      managed: managed && { kind: managed.kind, fingerprint: managed.fingerprint },
    })),
  };
};

const comparableTeamNotes = (element: ServicePlanElement) =>
  (element.teamNotes || [])
    .filter((note) => note.scope !== "role")
    .map((note) => ({
      label: normalizedText(note.label),
      note: richTextValue(note.note),
    }));

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

const formatRichTextForReview = (value: ServicePlanElement["notes"]) => {
  const blocks = normalizeRichTextDocument(value).blocks;
  return blocks.map((block) => {
    const blockStyles = [
      block.align && block.align !== "left" ? `${block.align}-aligned` : "",
      block.size ? `${block.size} text` : "",
      block.type === "list-item"
        ? `${block.listStyle === "ordered" ? "numbered" : "bulleted"} list${block.indent ? `, level ${block.indent + 1}` : ""}${block.listStart && block.listStart !== 1 ? `, starts at ${block.listStart}` : ""}`
        : "",
    ].filter(Boolean);
    const spans = block.spans.reduce<Array<{ text: string; styles: string[] }>>((result, span) => {
      const styles = [
        span.bold ? "bold" : "",
        span.italic ? "italic" : "",
        span.underline ? "underlined" : "",
        span.color ? `color ${span.color}` : "",
      ].filter(Boolean);
      const previous = result.at(-1);
      if (previous && JSON.stringify(previous.styles) === JSON.stringify(styles)) {
        previous.text += span.text;
      } else {
        result.push({ text: span.text, styles });
      }
      return result;
    }, []);
    const content = spans.map(({ text, styles }) =>
      styles.length ? `[${styles.join(", ")}: ${text}]` : text,
    ).join("");
    return `${blockStyles.length ? `[${blockStyles.join(", ")}] ` : ""}${content}`;
  }).join("\n") || "No text";
};

const formatNotes = (element: ServicePlanElement) => {
  const values = [
    ...(richTextToPlainText(element.notes).trim()
      ? [`Shared: ${formatRichTextForReview(element.notes)}`]
      : []),
    ...(element.teamNotes || [])
      .map((note) => {
        const text = richTextToPlainText(note.note).trim();
        return text ? `${note.label}: ${formatRichTextForReview(note.note)}` : "";
      })
      .filter(Boolean),
  ];
  return values.join(" · ") || "No notes";
};

const formatSongRef = (songRef: ReturnType<typeof getServicePlanElementSongRefs>[number]) => {
  const name = songRef.kind === "library" ? songRef.songName : songRef.title;
  const details = [songRef.key ? `Key ${songRef.key}` : ""];
  if (songRef.kind === "pending") {
    const lyrics = normalizedLyrics(songRef.lyricsText).replace(/\n/g, " / ");
    details.push(lyrics ? `Lyrics: ${lyrics.slice(0, 60)}${lyrics.length > 60 ? "…" : ""}` : "No lyrics");
  }
  return `${name}${details.filter(Boolean).length ? ` (${details.filter(Boolean).join(" · ")})` : ""}`;
};

const formatSong = (element: ServicePlanElement) => {
  const refs = getServicePlanElementSongRefs(element);
  if (!refs.length) return "No song";
  return refs.map(formatSongRef).join(", ");
};

const describeSongReferenceDifference = (
  current: ServicePlanElement,
  next: ServicePlanElement,
) => {
  const beforeRefs = getServicePlanElementSongRefs(current);
  const afterRefs = getServicePlanElementSongRefs(next);
  const sharedLength = Math.min(beforeRefs.length, afterRefs.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const before = beforeRefs[index];
    const after = afterRefs[index];
    if (JSON.stringify(songRefValue(before)) === JSON.stringify(songRefValue(after))) continue;
    if (before.kind === "library" && after.kind === "library" && before.songId !== after.songId) {
      return "linked library song changed";
    }
    if (before.kind !== after.kind) return "song reference type changed";
    if (before.kind === "pending" && after.kind === "pending" &&
      normalizedLyrics(before.lyricsText) !== normalizedLyrics(after.lyricsText)) {
      return "lyrics changed";
    }
    return "song reference details changed";
  }
  return beforeRefs.length === afterRefs.length
    ? "song reference details changed"
    : "number of song references changed";
};

const formatInterpretation = (element: ServicePlanElement) => {
  const ambiguity = element.importAmbiguity;
  if (!ambiguity) return "No review record";
  const parts = ambiguity.parts
    .map((part) => `${part.kind}: ${part.value} → ${part.destination}`)
    .join("; ");
  const songMappings = (ambiguity.songMappings || []).map(({ incoming, candidateOccurrenceIds }) =>
    `song link review: ${formatSongRef(incoming)} (${candidateOccurrenceIds.length} linked matches; current links preserved)`,
  ).join("; ");
  return `${ambiguity.status}${parts ? ` · ${parts}` : ""}${songMappings ? ` · ${songMappings}` : ""}`;
};

const formatSourceChanges = (element: ServicePlanElement) => {
  const state = element.servicePlanningImport;
  if (!state) return "Not tracked";
  if (!state.pendingFields.length) return "Up to date";
  return state.pendingFields.map((field) =>
    `${field}: ${normalizedText(state.applied[field]) || "empty"} → ${normalizedText(state.observed[field]) || "empty"}`,
  ).join("; ");
};

const formatScripture = (element: ServicePlanElement) =>
  getServicePlanElementScriptureRefs(element)
    .map((scriptureRef) => {
      const structured = `${scriptureRef.book} ${scriptureRef.chapter}${scriptureRef.verseRange ? `:${scriptureRef.verseRange}` : ""}${scriptureRef.version ? ` · ${scriptureRef.version}` : ""}`;
      return scriptureRef.label && normalizedText(scriptureRef.label) !== normalizedText(structured)
        ? `${scriptureRef.label} (${structured})`
        : scriptureRef.label || structured;
    })
    .join(", ") || "No scripture";

const describeScriptureReferenceDifference = (
  current: ServicePlanElement,
  next: ServicePlanElement,
) => {
  const beforeRefs = getServicePlanElementScriptureRefs(current);
  const afterRefs = getServicePlanElementScriptureRefs(next);
  const sharedLength = Math.min(beforeRefs.length, afterRefs.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const before = beforeRefs[index];
    const after = afterRefs[index];
    if (normalizedText(before.book) !== normalizedText(after.book)) return "Bible book changed";
    if (normalizedText(before.chapter) !== normalizedText(after.chapter)) return "chapter changed";
    if (normalizedText(before.verseRange) !== normalizedText(after.verseRange)) return "verse range changed";
    if (normalizedText(before.version) !== normalizedText(after.version)) return "Bible version changed";
  }
  return beforeRefs.length === afterRefs.length
    ? "scripture reference details changed"
    : "number of scripture references changed";
};

const changedFields = (
  current: ServicePlanElement,
  next: ServicePlanElement,
): ServicePlanImportFieldChange[] => {
  const fields: ServicePlanImportFieldChange[] = [];
  if (!richTextEqual(current.title, next.title)) {
    fields.push({
      label: "Title",
      before: formatRichTextForReview(current.title),
      after: formatRichTextForReview(next.title),
    });
  }
  if (!songsEqual(getServicePlanElementSongRefs(current), getServicePlanElementSongRefs(next))) {
    const before = formatSong(current);
    const after = formatSong(next);
    fields.push({
      label: "Song",
      before,
      after: before === after ? `${after} (${describeSongReferenceDifference(current, next)})` : after,
    });
  }
  if (!scripturesEqual(getServicePlanElementScriptureRefs(current), getServicePlanElementScriptureRefs(next))) {
    const before = formatScripture(current);
    const after = formatScripture(next);
    fields.push({
      label: "Scripture",
      before,
      after: before === after ? `${after} (${describeScriptureReferenceDifference(current, next)})` : after,
    });
  }
  if (normalizedText(current.sourceElementTypeRaw).toLocaleLowerCase() !==
    normalizedText(next.sourceElementTypeRaw).toLocaleLowerCase()) {
    fields.push({
      label: "Source type",
      before: optionalValue(current.sourceElementTypeRaw, "None"),
      after: optionalValue(next.sourceElementTypeRaw, "None"),
    });
  }
  if (JSON.stringify(comparableInterpretation(current)) !== JSON.stringify(comparableInterpretation(next))) {
    fields.push({
      label: "Import interpretation",
      before: formatInterpretation(current),
      after: formatInterpretation(next),
    });
  }
  const currentImportState = current.servicePlanningImport;
  const nextImportState = next.servicePlanningImport;
  if (currentImportState && nextImportState &&
    formatSourceChanges(current) !== formatSourceChanges(next)) {
    fields.push({
      label: "Source changes",
      before: formatSourceChanges(current),
      after: formatSourceChanges(next),
    });
  }
  const currentAssignees = getServicePlanElementAssigneeNames(current).map(normalizedText);
  const nextAssignees = getServicePlanElementAssigneeNames(next).map(normalizedText);
  const assignmentIdentity = (element: ServicePlanElement) =>
    getServicePlanElementAssignees(element)
      .map((assignee) => ({
        name: normalizedText(assignee.name),
        memberId: assignee.memberId || "",
        microphoneIds: [...(assignee.microphoneIds || [])].sort(),
        iemIds: [...(assignee.iemIds || [])].sort(),
      }))
      .filter((assignee) => assignee.name || assignee.memberId || assignee.microphoneIds.length || assignee.iemIds.length);
  const sameAssignment = JSON.stringify(assignmentIdentity(current)) ===
    JSON.stringify(assignmentIdentity(next));
  if (!sameAssignment) {
    fields.push({
      label: "Assignments and equipment",
      before: optionalValue(formatAssignmentSummary(current), "Unassigned"),
      after: optionalValue(formatAssignmentSummary(next), "Unassigned") +
        (JSON.stringify(currentAssignees) === JSON.stringify(nextAssignees)
          ? " (person link changed)"
          : ""),
    });
  }
  if (
    normalizedStartTime(current.startTime) !== normalizedStartTime(next.startTime) ||
    (current.durationSeconds ?? (current.durationMinutes ?? 0) * 60) !==
      (next.durationSeconds ?? (next.durationMinutes ?? 0) * 60)
  ) {
    fields.push({
      label: "Time or duration",
      before: formatTiming(current),
      after: formatTiming(next),
    });
  }
  if (
    !richTextEqual(current.notes, next.notes) ||
    JSON.stringify(comparableTeamNotes(current)) !== JSON.stringify(comparableTeamNotes(next))
  ) {
    fields.push({
      label: "Notes",
      before: formatNotes(current),
      after: formatNotes(next),
    });
  }
  return fields;
};

const formatAssignmentSummary = (element: ServicePlanElement) =>
  getServicePlanElementAssignees(element).map((assignee) => {
    const identity = normalizedText(assignee.name) || (assignee.memberId ? "Linked member" : "Unassigned slot");
    const equipment = [
      ...(assignee.microphoneIds || []).map((id) => `Mic ${id}`),
      ...(assignee.iemIds || []).map((id) => `IEM ${id}`),
    ].sort();
    return equipment.length ? `${identity} (${equipment.join(", ")})` : identity;
  }).join(", ");

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

  // Keep the review in service order. Alphabetical sorting is convenient for
  // a report, but makes an operator compare the import against the plan by
  // hand before applying it.
  const nextSectionIndex = new Map(
    nextSections.map((section, index) => [section.id, index]),
  );
  const currentSectionIndex = new Map(
    currentSections.map((section, index) => [section.id, index]),
  );
  const sectionOrder = new Map<string, number>();
  [...nextSections, ...currentSections].forEach((section) => {
    if (!sectionOrder.has(section.id)) {
      sectionOrder.set(
        section.id,
        nextSectionIndex.get(section.id) ?? nextSections.length + (currentSectionIndex.get(section.id) ?? 0),
      );
    }
  });
  const nextIdsBySection = new Map(
    nextSections.map((section) => [section.id, new Set(section.elements.map(({ id }) => id))]),
  );
  const nextPositionById = new Map(
    nextSections.flatMap((section) =>
      section.elements.map((element, index) => [element.id, index] as const),
    ),
  );
  const currentPositionById = new Map(
    currentSections.flatMap((section) =>
      section.elements.map((element, index) => [element.id, index] as const),
    ),
  );
  const originalChangeIndex = new Map(changes.map((change, index) => [servicePlanImportChangeKey(change), index]));

  changes.sort((left, right) => {
    const section = (sectionOrder.get(left.sectionId) ?? Number.MAX_SAFE_INTEGER) -
      (sectionOrder.get(right.sectionId) ?? Number.MAX_SAFE_INTEGER);
    if (section) return section;

    const orderFor = (change: ServicePlanImportChange) => {
      if (change.kind !== "removed") {
        return nextPositionById.get(change.id) ?? Number.MAX_SAFE_INTEGER;
      }
      const currentSection = currentSections.find((section) => section.id === change.sectionId);
      const nextIds = nextIdsBySection.get(change.sectionId) ?? new Set<string>();
      const currentIndex = currentPositionById.get(change.id) ?? 0;
      const nextItemsBefore = currentSection?.elements
        .slice(0, currentIndex)
        .filter(({ id }) => nextIds.has(id)).length ?? 0;
      return nextItemsBefore - 0.5;
    };
    const item = orderFor(left) - orderFor(right);
    if (item) return item;
    return (originalChangeIndex.get(servicePlanImportChangeKey(left)) ?? 0) -
      (originalChangeIndex.get(servicePlanImportChangeKey(right)) ?? 0);
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

  const currentSectionIdByNextIndex = new Map<number, string>();
  const newSectionByNextIndex = new Map<number, ServicePlanSection>();
  nextSections.forEach((nextSection, index) => {
    if (currentSectionIds.has(nextSection.id)) {
      currentSectionIdByNextIndex.set(index, nextSection.id);
      return;
    }
    const elements = nextSection.elements.filter((element) =>
      Boolean(selectedChangeFor("added", element.id)),
    );
    if (elements.length) {
      newSectionByNextIndex.set(index, { ...nextSection, elements });
    }
  });

  return insertNewServicePlanSectionRuns(
    result,
    nextSections.length,
    newSectionByNextIndex,
    currentSectionIdByNextIndex,
  );
};
