import { richTextSemanticEqual, richTextToPlainText } from "../../types/richText";
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
import { insertNewServicePlanSectionRuns } from "./servicePlanImportSectionPlacement";

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

const normalizedImportSourceValue = (value: string | undefined): string =>
  (value || "").replace(/\r\n?/g, "\n").trim().replace(/\s+/g, " ");

const ambiguityReviewFingerprint = (ambiguity: NonNullable<ServicePlanElement["importAmbiguity"]>) =>
  JSON.stringify({
    sourceElementType: normalizedImportSourceValue(ambiguity.sourceElementType),
    sourceTitle: normalizedImportSourceValue(ambiguity.sourceTitle),
    sourceLedBy: normalizedImportSourceValue(ambiguity.sourceLedBy),
    sourceNote: normalizedImportSourceValue(ambiguity.sourceNote),
    reasons: ambiguity.reasons,
    parts: ambiguity.parts.map(({ kind, value, destination, sourceField }) => ({
      kind, value, destination, sourceField: sourceField || "title",
    })),
  });

/** Return only unresolved imports that are new or materially changed in the
 * refreshed plan. Element IDs come from reconciliation, so inserting another
 * source row does not make an unchanged ambiguity look new. */
export const getNewServicePlanImportAmbiguityIds = (
  currentSections: ServicePlanSection[],
  nextSections: ServicePlanSection[],
): string[] => {
  const currentFingerprintById = new Map(
    currentSections.flatMap((section) => section.elements.flatMap((element) => {
      const ambiguity = element.importAmbiguity;
      return ambiguity && (ambiguity.status === "unresolved" || ambiguity.status === "deferred")
        ? [[element.id, ambiguityReviewFingerprint(ambiguity)] as const]
        : [];
    })),
  );
  return nextSections.flatMap((section) => section.elements.flatMap((element) => {
    const ambiguity = element.importAmbiguity;
    return ambiguity?.status === "unresolved" &&
      currentFingerprintById.get(element.id) !== ambiguityReviewFingerprint(ambiguity)
      ? [element.id]
      : [];
  }));
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

const normalizedSourceValue = (value: string): string =>
  value.replace(/\r\n?/g, "\n").trim().replace(/\s+/g, " ");

const normalizedLyrics = (value: string): string =>
  value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).join("\n").trim();

const normalizedStartTime = (value: string | undefined): string => {
  const time = normalizedSourceValue(value || "");
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : time;
};

const sameSourceValue = (left: string, right: string): boolean =>
  normalizedSourceValue(left) === normalizedSourceValue(right);

const sameRichText = (
  left: ServicePlanElement["notes"],
  right: ServicePlanElement["notes"],
) => richTextSemanticEqual(left, right);

const sameSongContent = (
  left: ReturnType<typeof getServicePlanElementSongRefs>[number],
  right: ReturnType<typeof getServicePlanElementSongRefs>[number],
): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === "library" && right.kind === "library") {
    return left.songId === right.songId &&
      normalized(left.songName) === normalized(right.songName) &&
      normalized(left.key || "") === normalized(right.key || "");
  }
  if (left.kind === "pending" && right.kind === "pending") {
    return normalized(left.title) === normalized(right.title) &&
      normalizedLyrics(left.lyricsText) === normalizedLyrics(right.lyricsText) &&
      normalized(left.key || "") === normalized(right.key || "");
  }
  return false;
};

const sameScriptureContent = (
  left: ReturnType<typeof getServicePlanElementScriptureRefs>[number],
  right: ReturnType<typeof getServicePlanElementScriptureRefs>[number],
): boolean => normalized(left.book) === normalized(right.book) &&
  normalized(left.chapter) === normalized(right.chapter) &&
  normalized(left.verseRange) === normalized(right.verseRange) &&
  normalized(left.version) === normalized(right.version);

/** Reuse occurrence IDs through increasingly weaker, deterministic evidence. */
const reconcileImportedSongRefs = (
  current: ServicePlanElement,
  imported: ServicePlanElement,
): ReturnType<typeof getServicePlanElementSongRefs> => {
  const currentRefs = getServicePlanElementSongRefs(current);
  const importedRefs = getServicePlanElementSongRefs(imported);
  const matchByIncomingIndex = new Map<number, number>();
  const usedCurrent = new Set<number>();
  const songTitle = (ref: (typeof currentRefs)[number]) =>
    normalized(ref.kind === "library" ? ref.songName : ref.title);

  const pair = (incomingIndex: number, currentIndex: number) => {
    matchByIncomingIndex.set(incomingIndex, currentIndex);
    usedCurrent.add(currentIndex);
  };

  // Semantic equality is strongest evidence and deliberately ignores occurrence IDs.
  importedRefs.forEach((incomingRef, incomingIndex) => {
    const candidates = currentRefs.flatMap((existing, index) =>
      !usedCurrent.has(index) && sameSongContent(existing, incomingRef)
        ? [index]
        : [],
    );
    if (candidates.length === 1) pair(incomingIndex, candidates[0]);
  });

  // A shared occurrence ID can establish continuity when content changed.
  importedRefs.forEach((incomingRef, incomingIndex) => {
    if (matchByIncomingIndex.has(incomingIndex) || !incomingRef.id) return;
    const identityIndex = currentRefs.findIndex((existing, index) =>
      !usedCurrent.has(index) && existing.id === incomingRef.id,
    );
    if (identityIndex >= 0) pair(incomingIndex, identityIndex);
  });

  // A linked library song ID is stable across key/name changes.
  importedRefs.forEach((incomingRef, incomingIndex) => {
    if (matchByIncomingIndex.has(incomingIndex) || incomingRef.kind !== "library") return;
    const identityIndex = currentRefs.findIndex((existing, index) =>
      !usedCurrent.has(index) && existing.kind === "library" &&
      existing.songId === incomingRef.songId,
    );
    if (identityIndex >= 0) pair(incomingIndex, identityIndex);
  });

  // A title is safe only when it identifies exactly one remaining occurrence
  // on each side. Exact-content matches above retain intentional duplicate order,
  // while this fallback prevents duplicate titles from preserving the wrong link.
  importedRefs.forEach((incomingRef, incomingIndex) => {
    if (matchByIncomingIndex.has(incomingIndex)) return;
    const title = songTitle(incomingRef);
    if (!title) return;
    const currentCandidates = currentRefs.flatMap((existing, index) =>
      !usedCurrent.has(index) && normalized(existing.kind === "library" ? existing.songName : existing.title) === title
        ? [index]
        : [],
    );
    const incomingCandidates = importedRefs.flatMap((candidate, index) =>
      !matchByIncomingIndex.has(index) &&
      normalized(candidate.kind === "library" ? candidate.songName : candidate.title) === title
        ? [index]
        : [],
    );
    if (currentCandidates.length === 1 && incomingCandidates.length === 1) {
      pair(incomingIndex, currentCandidates[0]);
    }
  });

  // Identical repeated pending entries have no content-based identity. When
  // their counts still match, preserve their source order rather than letting
  // the first exact match claim an arbitrary occurrence.
  const pendingTitles = new Set(importedRefs.flatMap((ref, index) =>
    !matchByIncomingIndex.has(index) && ref.kind === "pending" ? [songTitle(ref)] : [],
  ));
  pendingTitles.forEach((title) => {
    if (!title) return;
    const currentCandidates = currentRefs.flatMap((ref, index) =>
      !usedCurrent.has(index) && ref.kind === "pending" && songTitle(ref) === title
        ? [index]
        : [],
    );
    const incomingCandidates = importedRefs.flatMap((ref, index) =>
      !matchByIncomingIndex.has(index) && ref.kind === "pending" && songTitle(ref) === title
        ? [index]
        : [],
    );
    if (currentCandidates.length !== incomingCandidates.length) return;
    incomingCandidates.forEach((incomingIndex, index) => pair(incomingIndex, currentCandidates[index]));
  });

  return importedRefs.map((importedRef, incomingIndex) => {
    const matchIndex = matchByIncomingIndex.get(incomingIndex);
    if (matchIndex === undefined) return importedRef;
    const currentRef = currentRefs[matchIndex];
    if (currentRef.kind === "library" && importedRef.kind === "pending") {
      return currentRef;
    }
    if (sameSongContent(currentRef, importedRef)) return currentRef;
    if (currentRef.id && !importedRef.id) {
      return { ...importedRef, id: currentRef.id };
    }
    return importedRef;
  });
};

const labelsMatch = (left: string | string[], right: string | string[]): boolean => {
  const leftLabels = (Array.isArray(left) ? left : [left])
    .map(normalized)
    .filter(Boolean);
  const rightLabels = new Set(
    (Array.isArray(right) ? right : [right]).map(normalized).filter(Boolean),
  );
  return leftLabels.some((label) => rightLabels.has(label));
};

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
  label: (item: T) => string | string[],
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
        labelsMatch(label(existing.value), label(incoming.value)),
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
        normalized(currentNote.label) === normalized(importedNote.label) &&
        sameRichText(currentNote.note, importedNote.note),
    );
    const labelIndex =
      exactIndex >= 0
        ? exactIndex
        : available.findIndex(
            (currentNote) => normalized(currentNote.label) === normalized(importedNote.label),
          );
    if (labelIndex < 0) return importedNote;
    const [currentNote] = available.splice(labelIndex, 1);
    return exactIndex >= 0
      ? { ...importedNote, id: currentNote.id, label: currentNote.label, note: currentNote.note }
      : { ...importedNote, id: currentNote.id };
  });
};

const mergeElement = (
  current: ServicePlanElement,
  imported: ServicePlanElement,
  options: ServicePlanningRefreshOptions,
): ServicePlanElement => {
  let next: ServicePlanElement = { ...current, sourcePlanningManaged: true };
  const snapshotFor = (element: ServicePlanElement) =>
    element.servicePlanningImport?.observed || {
      elementType: element.sourceElementTypeRaw || element.importAmbiguity?.sourceElementType || "",
      title: element.sourceContentTitleRaw || element.importAmbiguity?.sourceTitle || "",
      ledBy: element.sourceLedByRaw || element.importAmbiguity?.sourceLedBy || "",
      note: element.sourceNoteRaw || element.importAmbiguity?.sourceNote || "",
    };
  const currentState = current.servicePlanningImport || {
    observed: snapshotFor(current),
    applied: snapshotFor(current),
    pendingFields: [],
  };
  const incomingObserved = snapshotFor(imported);
  const observed = {
    elementType: sameSourceValue(currentState.observed.elementType, incomingObserved.elementType)
      ? currentState.observed.elementType
      : incomingObserved.elementType,
    title: sameSourceValue(currentState.observed.title, incomingObserved.title)
      ? currentState.observed.title
      : incomingObserved.title,
    ledBy: sameSourceValue(currentState.observed.ledBy, incomingObserved.ledBy)
      ? currentState.observed.ledBy
      : incomingObserved.ledBy,
    note: sameSourceValue(currentState.observed.note, incomingObserved.note)
      ? currentState.observed.note
      : incomingObserved.note,
  };
  const applied = { ...currentState.applied };
  if (options.updateTitles) {
    if (!sameSourceValue(applied.elementType, observed.elementType)) {
      applied.elementType = observed.elementType;
    }
    if (!sameSourceValue(applied.title, observed.title)) applied.title = observed.title;
  }
  if (options.updateAssignments && !sameSourceValue(applied.ledBy, observed.ledBy)) {
    applied.ledBy = observed.ledBy;
  }
  if (options.updateNotes && !sameSourceValue(applied.note, observed.note)) {
    applied.note = observed.note;
  }
  const pendingFields = (["elementType", "title", "ledBy", "note"] as const)
    .filter((field) => !sameSourceValue(observed[field], applied[field]));
  next.servicePlanningImport = { observed, applied, pendingFields };
  const changedAcceptedTitle = options.updateTitles && (
    !sameSourceValue(currentState.applied.title, observed.title) ||
    !sameSourceValue(currentState.applied.elementType, observed.elementType)
  );
  const changedAcceptedNote = options.updateNotes &&
    !sameSourceValue(currentState.applied.note, observed.note);
  const changedAcceptedTitleOrNote = changedAcceptedTitle || changedAcceptedNote;
  const confirmed = current.importAmbiguity?.status === "confirmed" ||
    current.importAmbiguity?.status === "acknowledged";
  const preserveConfirmedTitle = confirmed && !changedAcceptedTitle;
  // A title can contain a person suggestion whose destination was explicitly
  // changed during review. Keep that assignee choice intact until the source
  // changes are reviewed; Led By still follows its own refresh option.
  const preserveConfirmedAssignees = confirmed && !changedAcceptedTitle &&
    (!options.updateAssignments || currentState.applied.ledBy === observed.ledBy);
  const preserveConfirmedNotes = confirmed && !changedAcceptedNote;
  if (options.updateTitles && !preserveConfirmedTitle) {
    next = {
      ...next,
      type: imported.type,
      ...(!sameRichText(current.title, imported.title)
        ? { title: imported.title }
        : {}),
    };
    // A refresh must not undo song linking: once a slot points at a real
    // library song, an unmatched ("pending") ref from the source is the weaker
    // of the two, so the operator's link stays. Check every song slot — a
    // worship set can keep a later library link even when an earlier one is
    // still pending.
    const currentSongRefs = getServicePlanElementSongRefs(current);
    const mergedSongRefs = reconcileImportedSongRefs(current, imported);
    const songRefsUnchanged =
      mergedSongRefs.length === currentSongRefs.length &&
      mergedSongRefs.every((ref, index) => ref === currentSongRefs[index]);
    if (!songRefsUnchanged) {
      next.songRefs = mergedSongRefs;
      delete next.songRef;
    }
    const currentScriptureRefs = getServicePlanElementScriptureRefs(current);
    const importedScriptureRefs = getServicePlanElementScriptureRefs(imported);
    const scriptureRefsUnchanged = currentScriptureRefs.length === importedScriptureRefs.length &&
      currentScriptureRefs.every((ref, index) =>
        sameScriptureContent(ref, importedScriptureRefs[index]),
      );
    if (!scriptureRefsUnchanged) {
      next.scriptureRefs = importedScriptureRefs.map((ref, index) => ({
        ...ref,
        ...(currentScriptureRefs[index]?.id && !ref.id
          ? { id: currentScriptureRefs[index].id }
          : {}),
      }));
      delete next.scriptureRef;
    }
    if (normalized(current.sourceElementTypeRaw || "") !== normalized(imported.sourceElementTypeRaw || "")) {
      next = copyOptionalField(next, imported, "sourceElementTypeRaw");
    }
    if (!sameSourceValue(current.sourceContentTitleRaw || "", imported.sourceContentTitleRaw || "")) {
      next = copyOptionalField(next, imported, "sourceContentTitleRaw");
    }
  }
  if (options.updateAssignments && !preserveConfirmedAssignees) {
    const mergedAssignees = mergeImportedAssignees(current, imported);
    if (JSON.stringify(mergedAssignees) !== JSON.stringify(getServicePlanElementAssignees(current))) {
      next.assignees = mergedAssignees;
    }
    if (!sameSourceValue(current.sourceLedByRaw || "", imported.sourceLedByRaw || "")) {
      next = copyOptionalField(next, imported, "sourceLedByRaw");
    }
    const comparableSourceAssignments = (assignments: ServicePlanElement["sourceLedByAssignments"]) =>
      (assignments || []).map(({ kind, id, name }) => ({ kind, id: id || "", name: normalized(name) }));
    if (JSON.stringify(comparableSourceAssignments(current.sourceLedByAssignments)) !==
      JSON.stringify(comparableSourceAssignments(imported.sourceLedByAssignments))) {
      next = copyOptionalField(next, imported, "sourceLedByAssignments");
    }
  }
  if (options.updateTiming) {
    if (normalizedStartTime(current.startTime) !== normalizedStartTime(imported.startTime)) {
      next = copyOptionalField(next, imported, "startTime");
    }
    const currentDurationSeconds = current.durationSeconds ?? (current.durationMinutes ?? 0) * 60;
    const importedDurationSeconds = imported.durationSeconds ?? (imported.durationMinutes ?? 0) * 60;
    if (currentDurationSeconds !== importedDurationSeconds) {
      next = copyOptionalField(next, imported, "durationSeconds");
      next = copyOptionalField(next, imported, "durationMinutes");
    }
  }
  if (options.updateNotes && !preserveConfirmedNotes) {
    if (!sameRichText(current.notes, imported.notes)) {
      next = copyOptionalField(next, imported, "notes");
    }
    if (!sameSourceValue(current.sourceNoteRaw || "", imported.sourceNoteRaw || "")) {
      next = copyOptionalField(next, imported, "sourceNoteRaw");
    }
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

  // Reconcile interpretation metadata independently from destination updates.
  // A declined title or note remains observed and pending, never applied later
  // just because another refresh happens to enable that field.
  const currentAmbiguity = current.importAmbiguity;
  const importedAmbiguity = imported.importAmbiguity;
  if (!changedAcceptedTitleOrNote) {
    if (currentAmbiguity) next.importAmbiguity = {
      ...currentAmbiguity,
      sourceElementType: importedAmbiguity?.sourceElementType ?? observed.elementType,
      sourceTitle: importedAmbiguity?.sourceTitle ?? observed.title,
      sourceLedBy: importedAmbiguity?.sourceLedBy ?? observed.ledBy,
      ...(observed.note ? { sourceNote: observed.note } : {}),
      sourceFingerprint: importedAmbiguity?.sourceFingerprint || currentAmbiguity.sourceFingerprint,
    };
  } else if (importedAmbiguity) {
    const acceptedFields = new Set([
      ...(options.updateTitles ? ["title"] : []),
      ...(options.updateNotes ? ["note"] : []),
    ]);
    const retainedParts = (currentAmbiguity?.parts || []).filter((part) =>
      !acceptedFields.has(part.sourceField || "title"),
    );
    const acceptedParts = importedAmbiguity.parts.filter((part) =>
      acceptedFields.has(part.sourceField || "title"),
    );
    next.importAmbiguity = {
      ...importedAmbiguity,
      parts: [...retainedParts, ...acceptedParts],
      status: importedAmbiguity.status === "unresolved" ? "unresolved" : "confirmed",
    };
  } else if (currentAmbiguity && changedAcceptedTitleOrNote) {
    delete next.importAmbiguity;
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

  // A section is a named container, not a reusable slot. Residual order cannot
  // prove that an unfamiliar incoming section is a renamed existing section:
  // a newly-added late-service section would otherwise consume the first
  // unmatched section and inherit its position and local content.
  const sectionPairs = pairByLabelThenOrder(
    currentSections,
    importedSections,
    (section) => section.name,
    canPairByLabel,
    () => false,
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
        (element) => [
          richTextToPlainText(element.title),
          element.sourceElementTypeRaw || "",
          element.sourceContentTitleRaw || "",
        ],
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
    const currentSectionIdByImportedIndex = new Map(
      sectionPairs.map(([current, imported]) => [
        imported.index,
        current.value.id,
      ]),
    );
    const newSectionByImportedIndex = new Map(
      importedSections.flatMap((section, index) =>
        pairedImportedSections.has(index)
          ? []
          : [[index, managedImportedSection(section)] as const],
      ),
    );
    return insertNewServicePlanSectionRuns(
      refreshed,
      importedSections.length,
      newSectionByImportedIndex,
      currentSectionIdByImportedIndex,
    );
  }
  return refreshed;
};
