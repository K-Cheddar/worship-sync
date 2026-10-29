import { multilineTextToRichText, richTextSemanticEqual, richTextToPlainText } from "../../types/richText";
import {
  getServicePlanElementType,
  getServicePlanElementAssignees,
  getServicePlanElementSongRefs,
  isUnassignedServicePlanAssignee,
} from "../../types/servicePlan";
import generateRandomId from "../../utils/generateRandomId";
import type {
  ServicePlanAssignee,
  ServicePlanElement,
  ServicePlanSection,
  ServicePlanTeamNote,
} from "../../types/servicePlan";
import { insertNewServicePlanSectionRuns, placeServicePlanImportElements } from "./servicePlanImportSectionPlacement";
import { reconcileReviewedServicePlanParts, servicePlanNoteFingerprint, upgradeLegacyImportedDescriptionTitles } from "./servicePlanImportOwnership";
import { splitServicePlanningLedByNames } from "./servicePlanFromImport";
import { claimServicePlanAssigneeSlot, copyServicePlanAssigneeEquipment, hasServicePlanAssigneeEquipment, stripServicePlanAssigneeIdentityPreservingEquipment } from "./servicePlanAssigneeUtils";
import {
  servicePlanImportAmbiguityShouldQueue,
} from "./servicePlanningTitleClassifier";
import { getServicePlanSongReferenceFingerprint } from "./servicePlanSongAttachmentUtils";
import { normalizePlanningCenterPdfTitle } from "./planningCenterPdfParser";

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
  /** Build individually reviewable legacy-match suggestions for import preview. */
  suggestLegacyMatches?: boolean;
  /** Enable synthetic duplicate-title identity used only by PDF imports. */
  planningCenterPdfMatch?: boolean;
};

const normalizedSourceValue = (value: string | undefined): string =>
  (value || "").replace(/\r\n?/g, "\n").trim().replace(/\s+/g, " ");

const ambiguityReviewFingerprint = (ambiguity: NonNullable<ServicePlanElement["importAmbiguity"]>) =>
  JSON.stringify({
    sourceElementType: normalizedSourceValue(ambiguity.sourceElementType),
    sourceTitle: normalizedSourceValue(ambiguity.sourceTitle),
    sourceLedBy: normalizedSourceValue(ambiguity.sourceLedBy),
    sourceNote: normalizedSourceValue(ambiguity.sourceNote),
    reasons: ambiguity.reasons,
    songMappings: (ambiguity.songMappings || []).map(({ incoming, candidateOccurrenceIds, sourceFingerprint, mappingId }) => ({
      incoming,
      candidateOccurrenceIds: [...candidateOccurrenceIds].sort(),
      sourceFingerprint,
      mappingId,
    })),
    parts: ambiguity.parts.map(({ kind, value, destination, sourceField }) => ({
      kind, value, destination, sourceField: sourceField || "title",
    })),
  });

/** Return only reviewable imports that are new or materially changed in the
 * refreshed plan. Element IDs come from reconciliation, so inserting another
 * source row does not make an unchanged ambiguity look new. */
export const getNewServicePlanImportAmbiguityIds = (
  currentSections: ServicePlanSection[],
  nextSections: ServicePlanSection[],
): string[] => {
  const currentFingerprintById = new Map(
    currentSections.flatMap((section) => section.elements.flatMap((element) => {
      const ambiguity = element.importAmbiguity;
      return ambiguity &&
        (ambiguity.status === "deferred" || servicePlanImportAmbiguityShouldQueue(ambiguity))
        ? [[element.id, ambiguityReviewFingerprint(ambiguity)] as const]
        : [];
    })),
  );
  return nextSections.flatMap((section) => section.elements.flatMap((element) => {
    const ambiguity = element.importAmbiguity;
    return ambiguity && servicePlanImportAmbiguityShouldQueue(ambiguity) &&
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
    suggestLegacyMatches: false,
  };

type Indexed<T> = { value: T; index: number };
type ImportedSongMapping = NonNullable<NonNullable<ServicePlanElement["importAmbiguity"]>["songMappings"]>[number];

const normalized = (value: string): string =>
  value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

const getPlanningCenterPdfMatchingTitle = (element: ServicePlanElement): string => {
  return normalizePlanningCenterPdfTitle(
    element.servicePlanningImport?.observed.title || element.sourceContentTitleRaw ||
      richTextToPlainText(element.title),
  ).matchingTitle;
};

const makePlanningCenterPdfMatchKey = (
  title: string,
  durationSeconds: number,
  duplicate: boolean,
  occurrence: number,
): string => JSON.stringify(duplicate
  ? ["planningCenterPdf", title, "duplicate", durationSeconds, occurrence]
  : ["planningCenterPdf", title, "single"]);

const getElementImportIdentity = (
  element: ServicePlanElement,
  usePlanningCenterPdfMatchKey = false,
): string | undefined => element.sourceOccurrenceId?.trim() ||
  (usePlanningCenterPdfMatchKey && element.sourcePlanningManaged
    ? element.planningCenterPdfMatchKey?.trim()
    : undefined) || undefined;

/** Normalize PDF evidence and resolve duplicate occurrences once. The result
 * carries local IDs as transient associations, never source positions as IDs. */
export const preparePlanningCenterPdfImport = (
  currentSections: ServicePlanSection[],
  importedSections: ServicePlanSection[],
): { currentSections: ServicePlanSection[]; importedSections: ServicePlanSection[] } => {
  let position = 0;
  const current = currentSections.map((section) => ({ ...section, elements: section.elements.map((element) => {
    const result = { ...element };
    delete result.importMatchCurrentId;
    if (!element.sourcePlanningManaged) {
      delete result.planningCenterPdfMatchKey;
      delete result.planningCenterPdfSourcePosition;
    }
    return result;
  }) }));
  const imported = importedSections.map((section) => ({ ...section, elements: section.elements.map((element) => {
    const result = { ...element, planningCenterPdfSourcePosition: position++ };
    delete result.importMatchCurrentId;
    return result;
  }) }));
  const sectionByElement = new Map([...current, ...imported].flatMap((section) =>
    section.elements.map((element) => [element, section.name] as const)));
  const groups = (sections: ServicePlanSection[], managedOnly: boolean) => {
    const result = new Map<string, ServicePlanElement[]>();
    sections.forEach((section) => section.elements.forEach((element) => {
      if (managedOnly && !element.sourcePlanningManaged) return;
      const title = getPlanningCenterPdfMatchingTitle(element);
      result.set(title, [...(result.get(title) || []), element]);
    }));
    return result;
  };
  const contexts = (sections: ServicePlanSection[], managedOnly: boolean) => {
    const result = new Map<ServicePlanElement, string>();
    sections.forEach((section) => {
      const elements = section.elements.filter((element) => !managedOnly || element.sourcePlanningManaged);
      elements.forEach((element, index) => {
        const differentTitle = (candidate: ServicePlanElement) => getPlanningCenterPdfMatchingTitle(candidate) !== getPlanningCenterPdfMatchingTitle(element);
        const previous = elements.slice(0, index).reverse().find(differentTitle);
        const next = elements.slice(index + 1).find(differentTitle);
        const key = (neighbor: ServicePlanElement | undefined) => neighbor
          ? [neighbor.sourceOccurrenceId || "", normalized(neighbor.sourceElementTypeRaw || neighbor.type), getPlanningCenterPdfMatchingTitle(neighbor)] : "boundary";
        result.set(element, JSON.stringify([section.name, key(previous), key(next)]));
      });
    });
    return result;
  };
  const currentGroups = groups(current, true);
  const incomingGroups = groups(imported, false);
  const currentContexts = contexts(current, true);
  const incomingContexts = contexts(imported, false);
  const seconds = (element: ServicePlanElement) => element.durationSeconds ?? Math.round((element.durationMinutes || 0) * 60);
  const durationCounts = (elements: ServicePlanElement[], value: number) => elements.filter((element) => seconds(element) === value).length;
  new Set([...currentGroups.keys(), ...incomingGroups.keys()]).forEach((title) => {
    const existing = currentGroups.get(title) || [];
    const incoming = incomingGroups.get(title) || [];
    const duplicate = existing.length > 1 || incoming.length > 1 || existing.some((element) => {
      try { return JSON.parse(element.planningCenterPdfMatchKey || "null")?.[2] === "duplicate"; }
      catch { return false; }
    });
    if (!duplicate && !existing.some((element) => element.planningCenterPdfMatchKey || element.planningCenterPdfMatchReviewRequired)) return;
    const initializeKeys = (elements: ServicePlanElement[]) => {
      const occurrences = new Map<number, number>();
      elements.forEach((element) => {
        const duration = seconds(element);
        const occurrence = occurrences.get(duration) || 0;
        occurrences.set(duration, occurrence + 1);
        element.planningCenterPdfMatchKey ||= makePlanningCenterPdfMatchKey(title, duration, duplicate, occurrence);
      });
    };
    initializeKeys(existing);
    if (!existing.length) { initializeKeys(incoming); return; }
    const claimedExisting = new Set(existing.filter((element) => element.sourceOccurrenceId));
    const claimedIncoming = new Set(incoming.filter((element) => element.sourceOccurrenceId));
    const safeExisting = (element: ServicePlanElement) => !claimedExisting.has(element) &&
      !element.planningCenterPdfMatchReviewRequired && existing.filter((candidate) =>
        candidate.planningCenterPdfMatchKey === element.planningCenterPdfMatchKey).length === 1;
    const associate = (element: ServicePlanElement, candidate: ServicePlanElement) => {
      element.importMatchCurrentId = candidate.id;
      element.planningCenterPdfMatchKey = candidate.planningCenterPdfMatchKey;
      claimedExisting.add(candidate);
      claimedIncoming.add(element);
    };
    incoming.forEach((element) => {
      if (claimedIncoming.has(element)) return;
      const context = incomingContexts.get(element);
      const candidates = existing.filter((candidate) => safeExisting(candidate) && currentContexts.get(candidate) === context);
      if (candidates.length === 1 && incoming.filter((candidate) => incomingContexts.get(candidate) === context).length === 1) {
        associate(element, candidates[0]);
      }
    });
    const occurrenceByDuration = new Map<number, number>();
    incoming.forEach((element) => {
      const duration = seconds(element);
      const occurrence = occurrenceByDuration.get(duration) || 0;
      occurrenceByDuration.set(duration, occurrence + 1);
      if (claimedIncoming.has(element)) return;
      // Occurrence rank is only evidence when the complete duration group is
      // unchanged. A count change requires unique context or confirmation.
      if (durationCounts(existing, duration) !== durationCounts(incoming, duration)) return;
      const candidate = existing.filter((candidate) => seconds(candidate) === duration)[occurrence];
      if (candidate && safeExisting(candidate)) associate(element, candidate);
    });
    new Set(incoming.map((element) => sectionByElement.get(element))).forEach((sectionName) => {
      const oldRows = existing.filter((element) => !claimedExisting.has(element) && sectionByElement.get(element) === sectionName);
      const newRows = incoming.filter((element) => !claimedIncoming.has(element) && sectionByElement.get(element) === sectionName);
      if (oldRows.length === 1 && newRows.length === 1 && safeExisting(oldRows[0]) && seconds(oldRows[0]) !== seconds(newRows[0])) {
        associate(newRows[0], oldRows[0]);
        return;
      }
      newRows.slice(0, oldRows.length).forEach((element, index) => {
        element.legacyImportMatchCandidateForId = oldRows[index].id;
        claimedExisting.add(oldRows[index]);
        claimedIncoming.add(element);
      });
    });
    incoming.forEach((element) => {
      if (!element.importMatchCurrentId && !element.sourceOccurrenceId) delete element.planningCenterPdfMatchKey;
    });
  });
  return { currentSections: current, importedSections: imported };
};

const normalizedLyrics = (value: string): string =>
  value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).join("\n").trim();

const sameOccurrenceIds = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
};

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

const dismissedSourceSongStillMatches = (
  current: ServicePlanElement,
  imported: ServicePlanElement,
): boolean => {
  if (!current.sourceSongReferenceDismissed) return false;
  const dismissedOccurrenceId = current.sourceSongReferenceDismissedOccurrenceId || current.sourceOccurrenceId;
  if (dismissedOccurrenceId && dismissedOccurrenceId !== imported.sourceOccurrenceId) return false;
  const importedRefs = getServicePlanElementSongRefs(imported);
  if (current.sourceSongReferenceDismissedFingerprint) {
    return importedRefs.some((songRef) =>
      getServicePlanSongReferenceFingerprint(songRef) === current.sourceSongReferenceDismissedFingerprint,
    );
  }
  // Older dismissals did not retain a song fingerprint. Keep them only while
  // both the durable row identity (when present) and raw source title match.
  return sameSourceValue(
    current.sourceContentTitleRaw || richTextToPlainText(current.title),
    imported.sourceContentTitleRaw || richTextToPlainText(imported.title),
  ) && normalized(current.sourceElementTypeRaw || "") === normalized(imported.sourceElementTypeRaw || "");
};

/** Reuse occurrence IDs through increasingly weaker, deterministic evidence. */
const reconcileImportedSongRefs = (
  current: ServicePlanElement,
  imported: ServicePlanElement,
): {
  refs: ReturnType<typeof getServicePlanElementSongRefs>;
  songMappings: NonNullable<ServicePlanElement["importAmbiguity"]>["songMappings"];
} => {
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

  // A pending source song with several remaining same-title library matches
  // must not replace every existing link with an unlinked placeholder. Keep
  // those occurrences and route the decision through the existing review.
  const ambiguousCandidatesByIncoming = new Map<number, number[]>();
  importedRefs.forEach((incomingRef, incomingIndex) => {
    if (matchByIncomingIndex.has(incomingIndex) || incomingRef.kind !== "pending") return;
    const title = songTitle(incomingRef);
    const sourceFingerprint = JSON.stringify([
      normalized(incomingRef.title),
      normalizedLyrics(incomingRef.lyricsText),
      normalized(incomingRef.key || ""),
    ]);
    const priorMapping = current.importAmbiguity?.songMappings?.find((mapping) =>
      mapping.sourceFingerprint === sourceFingerprint && mapping.resolution?.kind === "keep",
    );
    const candidates = currentRefs.flatMap((existing, index) =>
      !usedCurrent.has(index) && existing.kind === "library" && songTitle(existing) === title
        && (!priorMapping || priorMapping.candidateOccurrenceIds.includes(existing.id || ""))
        ? [index]
        : [],
    );
    if (title && (candidates.length > 1 || priorMapping)) ambiguousCandidatesByIncoming.set(incomingIndex, candidates);
  });

  // A title is safe only when it identifies exactly one remaining occurrence
  // on each side. Exact-content matches above retain intentional duplicate order,
  // while this fallback prevents duplicate titles from preserving the wrong link.
  importedRefs.forEach((incomingRef, incomingIndex) => {
    if (matchByIncomingIndex.has(incomingIndex) || ambiguousCandidatesByIncoming.has(incomingIndex)) return;
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

  const ambiguousCandidateIndexes = new Set<number>();
  const songMappings: NonNullable<ServicePlanElement["importAmbiguity"]>["songMappings"] = [];
  const mappingOccurrences = new Map<string, number>();
  const refs = importedRefs.flatMap((importedRef, incomingIndex) => {
    const ambiguousCandidates = ambiguousCandidatesByIncoming.get(incomingIndex);
    if (ambiguousCandidates) {
      if (importedRef.kind !== "pending") return [importedRef];
      const candidateRefs = ambiguousCandidates
        .filter((index) => !ambiguousCandidateIndexes.has(index))
        .map((index) => {
          ambiguousCandidateIndexes.add(index);
          return currentRefs[index];
        });
      const sourceFingerprint = JSON.stringify([
        normalized(importedRef.title),
        normalizedLyrics(importedRef.lyricsText),
        normalized(importedRef.key || ""),
      ]);
      const candidateOccurrenceIds = ambiguousCandidates.flatMap((index) =>
        currentRefs[index].id ? [currentRefs[index].id!] : [],
      );
      const occurrenceKey = JSON.stringify([sourceFingerprint, [...candidateOccurrenceIds].sort()]);
      const occurrence = mappingOccurrences.get(occurrenceKey) || 0;
      mappingOccurrences.set(occurrenceKey, occurrence + 1);
      // The rank is local to identical occurrences with the same eligible set,
      // so unrelated songs can be inserted or reordered without changing it.
      const mappingId = JSON.stringify([occurrenceKey, occurrence]);
      const oldMappings = current.importAmbiguity?.songMappings || [];
      const legacyMatches = oldMappings.filter((mapping) =>
        !mapping.mappingId && mapping.sourceFingerprint === sourceFingerprint &&
        sameOccurrenceIds(mapping.candidateOccurrenceIds, candidateOccurrenceIds),
      );
      const sameOccurrenceCandidates = oldMappings.filter((mapping) =>
        sameOccurrenceIds(mapping.candidateOccurrenceIds, candidateOccurrenceIds),
      );
      const priorMapping = oldMappings.find((mapping) => mapping.mappingId === mappingId) ||
        (sameOccurrenceCandidates.length === 1 ? sameOccurrenceCandidates[0] : undefined) ||
        (legacyMatches.length === 1 && oldMappings.filter((mapping) =>
          !mapping.mappingId && mapping.sourceFingerprint === sourceFingerprint,
        ).length === 1 ? legacyMatches[0] : undefined);
      songMappings?.push({
        incoming: importedRef as Extract<typeof importedRef, { kind: "pending" }>,
        candidateOccurrenceIds,
        mappingId: priorMapping?.mappingId || mappingId,
        sourceFingerprint,
        ...(priorMapping?.sourceFingerprint === sourceFingerprint && priorMapping.resolution
          ? { resolution: priorMapping.resolution }
          : {}),
      });
      return candidateRefs;
    }
    const matchIndex = matchByIncomingIndex.get(incomingIndex);
    if (matchIndex === undefined) return [importedRef];
    const currentRef = currentRefs[matchIndex];
    if (currentRef.kind === "library" && importedRef.kind === "pending") {
      return [currentRef];
    }
    if (sameSongContent(currentRef, importedRef)) return [currentRef];
    return [{ ...importedRef, ...(currentRef.id ? { id: currentRef.id } : {}) }];
  });
  importedRefs.forEach((importedRef) => {
    if (importedRef.kind !== "pending") return;
    const sourceFingerprint = JSON.stringify([
      normalized(importedRef.title), normalizedLyrics(importedRef.lyricsText), normalized(importedRef.key || ""),
    ]);
    const priorMapping = current.importAmbiguity?.songMappings?.find((mapping) =>
      mapping.sourceFingerprint === sourceFingerprint && mapping.resolution?.kind === "replace",
    );
    const resolution = priorMapping?.resolution;
    if (!priorMapping || resolution?.kind !== "replace") return;
    currentRefs.forEach((currentRef, index) => {
      if (!currentRef.id || currentRef.id === resolution.occurrenceId ||
        !priorMapping.candidateOccurrenceIds.includes(currentRef.id) || usedCurrent.has(index) ||
        refs.some((ref) => ref.id === currentRef.id)) return;
      refs.push(currentRef);
    });
  });
  return { refs, songMappings };
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
  identity: (item: T) => string | undefined = () => undefined,
  canPairImported: (item: T) => boolean = () => true,
): Array<[Indexed<T>, Indexed<T>]> => {
  const availableCurrent = current.map((value, index) => ({ value, index }));
  const availableImported = imported.map((value, index) => ({ value, index }));
  const pairs: Array<[Indexed<T>, Indexed<T>]> = [];
  const usedCurrent = new Set<number>();
  const usedImported = new Set<number>();
  const identitiesAreCompatible = (currentItem: T, importedItem: T): boolean => {
    const currentIdentity = identity(currentItem)?.trim();
    const importedIdentity = identity(importedItem)?.trim();
    return !currentIdentity || !importedIdentity || currentIdentity === importedIdentity;
  };

  for (const incoming of availableImported) {
    if (!canPairImported(incoming.value)) continue;
    const sourceIdentity = identity(incoming.value);
    if (!sourceIdentity) continue;
    const candidate = availableCurrent.find((existing) =>
      !usedCurrent.has(existing.index) && identity(existing.value) === sourceIdentity,
    );
    if (!candidate) continue;
    usedCurrent.add(candidate.index);
    usedImported.add(incoming.index);
    pairs.push([candidate, incoming]);
  }

  for (const incoming of availableImported) {
    const candidate = availableCurrent.find(
      (existing) =>
        !usedImported.has(incoming.index) &&
        !usedCurrent.has(existing.index) &&
        identitiesAreCompatible(existing.value, incoming.value) &&
        canPairImported(incoming.value) &&
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
    (item) => !usedImported.has(item.index) && canPairImported(item.value),
  );
  const count = Math.min(remainingCurrent.length, remainingImported.length);
  for (let index = 0; index < count; index += 1) {
    if (identitiesAreCompatible(remainingCurrent[index].value, remainingImported[index].value)) {
      pairs.push([remainingCurrent[index], remainingImported[index]]);
    }
  }
  return pairs;
};

/**
 * Take the source's people while keeping operator-owned equipment.
 *
 * Microphones and IEMs live on assignees, so replacing the list outright would
 * delete equipment on every refresh — the very thing assignment updates must
 * not touch. Local equipment follows the person by name when the source
 * reorders them; unmatched slots still fall back to position so a rename keeps
 * the mic. Any local slot the source does not name survives as an unassigned
 * one so its equipment is never dropped.
 */
export const mergeImportedAssignees = (
  current: ServicePlanElement,
  imported: ServicePlanElement,
): ServicePlanAssignee[] => {
  const currentAssignees = getServicePlanElementAssignees(current);
  const importedAssignees = getServicePlanElementAssignees(imported);
  /** Strip the person, keep whatever they were carrying. */
  const asUnassigned = (assignee: ServicePlanAssignee): ServicePlanAssignee =>
    stripServicePlanAssigneeIdentityPreservingEquipment(assignee) || { id: assignee.id };

  if (!importedAssignees.length) {
    return currentAssignees
      .filter(hasServicePlanAssigneeEquipment)
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
      return copyServicePlanAssigneeEquipment({
        id: existing?.id ?? importedAssignee.id,
        ...(importedAssignee.name ? { name: importedAssignee.name } : {}),
      }, existing);
    }),
    ...currentAssignees
      .filter((_, index) => !pairedCurrentIndexes.has(index))
      .filter(hasServicePlanAssigneeEquipment)
      .map(asUnassigned),
  ];
};

const assigneeFingerprint = (assignee: ServicePlanAssignee) => JSON.stringify({ name: assignee.name });

/** Reconcile the independently owned title and Led By people while leaving
 * operator-created assignees and their member/equipment links intact. */
const reconcileImportedSourceAssignees = (
  current: ServicePlanElement,
  imported: ServicePlanElement,
  previousLedBy: string,
): { assignees: ServicePlanAssignee[]; managedAssignees: NonNullable<ServicePlanElement["servicePlanningImport"]>["managedAssignees"] } => {
  const existing = getServicePlanElementAssignees(current).map((assignee) => ({ ...assignee }));
  const existingOwnership = current.servicePlanningImport?.managedAssignees || [];
  const oldLedByNames = splitServicePlanningLedByNames(previousLedBy);
  const incomingLedByRaw = imported.sourceLedByRaw || imported.servicePlanningImport?.observed.ledBy || imported.importAmbiguity?.sourceLedBy || "";
  const incomingNames = splitServicePlanningLedByNames(incomingLedByRaw);
  const incomingLedBy = getServicePlanElementAssignees(imported).flatMap((assignee) => {
    const ownership = imported.servicePlanningImport?.managedAssignees?.find((item) => item.id === assignee.id);
    if (ownership?.fields.includes("ledBy")) return [{ assignee, ownership }];
    const matches = incomingNames.filter((name) => normalized(name) === normalized(assignee.name || ""));
    if (!matches.length || getServicePlanElementAssignees(imported).filter((candidate) => normalized(candidate.name || "") === normalized(assignee.name || "")).length !== 1) return [];
    return [{
      assignee,
      ownership: { id: assignee.id, fields: ["ledBy" as const], fingerprint: assigneeFingerprint(assignee) },
    }];
  });
  const incomingTitle = getServicePlanElementAssignees(imported).flatMap((assignee) => {
    const ownership = imported.servicePlanningImport?.managedAssignees?.find((item) => item.id === assignee.id);
    if (!ownership?.fields.includes("title") || ownership.fields.includes("ledBy")) return [];
    const priorTitleDecision = current.importAmbiguity?.parts.find((part) =>
      (part.sourceField || "title") === "title" &&
      (part.kind === "person" || part.kind === "description") &&
      normalized(part.value) === normalized(assignee.name || ""),
    );
    // The saved destination belongs to this exact source value. A reviewed
    // move away from assignees must survive unchanged-title refreshes.
    if (priorTitleDecision && priorTitleDecision.destination !== "assignee") return [];
    return [{ assignee, ownership }];
  });
  const ownedOld = new Set<number>();
  const currentByIncoming = new Map<number, number>();
  const operatorOwnedMatches = new Set<number>();
  const used = new Set<number>();
  const normalizedName = (name: string | undefined) => normalized(name || "");

  existing.forEach((assignee, index) => {
    const ownership = existingOwnership.find((item) => item.id === assignee.id);
    const verified = ownership && ownership.fingerprint === assigneeFingerprint(assignee);
    if (verified && ownership.fields.includes("ledBy")) {
      ownedOld.add(index);
      return;
    }
    // Legacy imported plans have no per-assignee marker. Only use a unique
    // name match against the last applied Led By snapshot as weak evidence.
    const oldNames = oldLedByNames.filter((name) => normalizedName(name) === normalizedName(assignee.name));
    const matchingCurrent = existing.filter((candidate) => normalizedName(candidate.name) === normalizedName(assignee.name));
    if (!ownership && oldNames.length === 1 && matchingCurrent.length === 1 && current.sourcePlanningManaged) ownedOld.add(index);
    // Plans saved before Led By snapshots stored the source person only as
    // assignedName. Treat that single legacy slot as source-owned so an
    // assignment refresh replaces it instead of keeping it beside the import.
    if (
      !ownedOld.has(index) &&
      !ownership &&
      oldLedByNames.length === 0 &&
      assignee.id === "legacy-assignee" &&
      current.sourcePlanningManaged &&
      incomingNames.length > 0 &&
      matchingCurrent.length === 1
    ) {
      ownedOld.add(index);
    }
  });

  incomingLedBy.forEach((incomingAssignee, incomingIndex) => {
    const identity = incomingAssignee.ownership.ledByIdentity;
    let match = identity
      ? [...ownedOld].find((index) => existingOwnership.find((item) => item.id === existing[index].id)?.ledByIdentity === identity && !used.has(index))
      : undefined;
    if (match === undefined) {
      const candidates = [...ownedOld].filter((index) => !used.has(index) && normalizedName(existing[index].name) === normalizedName(incomingAssignee.assignee.name));
      if (candidates.length === 1) match = candidates[0];
    }
    if (match !== undefined) {
      used.add(match);
      currentByIncoming.set(incomingIndex, match);
    }
  });

  // Reuse a same-name operator-owned row without making the source
  // responsible for its future changes.
  incomingLedBy.forEach((incomingAssignee, incomingIndex) => {
    if (currentByIncoming.has(incomingIndex)) return;
    const candidates = existing.flatMap((assignee, index) => {
      const ownership = existingOwnership.find((item) => item.id === assignee.id);
      return !used.has(index) && !ownedOld.has(index) && !ownership &&
        normalizedName(assignee.name) === normalizedName(incomingAssignee.assignee.name)
        ? [index]
        : [];
    });
    if (candidates.length !== 1) return;
    const match = candidates[0];
    used.add(match);
    currentByIncoming.set(incomingIndex, match);
    operatorOwnedMatches.add(match);
  });

  const remainingOld = [...ownedOld].filter((index) => !used.has(index));
  const remainingIncoming = incomingLedBy.map((_, index) => index).filter((index) => !currentByIncoming.has(index));
  if (remainingOld.length === remainingIncoming.length) {
    remainingIncoming.forEach((incomingIndex, index) => {
      const oldIndex = remainingOld[index];
      used.add(oldIndex);
      currentByIncoming.set(incomingIndex, oldIndex);
    });
  }

  // Template equipment is represented by blank assignee rows. After identity
  // and name matches have first refusal, hand out remaining equipment slots in
  // their existing order. An unmatched source-owned row with equipment is
  // also safe to reuse because its old source person is being removed.
  const fallbackIncoming = incomingLedBy.map((_, index) => index).filter((index) => !currentByIncoming.has(index));
  const fallbackSlots = existing.flatMap((assignee, index) =>
    !used.has(index) && hasServicePlanAssigneeEquipment(assignee) &&
      (isUnassignedServicePlanAssignee(assignee) || ownedOld.has(index))
      ? [index]
      : [],
  );
  fallbackIncoming.slice(0, fallbackSlots.length).forEach((incomingIndex, index) => {
    const slot = fallbackSlots[index];
    used.add(slot);
    currentByIncoming.set(incomingIndex, slot);
  });

  const reconciledLedBy = incomingLedBy.map((incomingAssignee, index) => {
    const previous = currentByIncoming.get(index) === undefined ? undefined : existing[currentByIncoming.get(index)!];
    const identity = incomingAssignee.ownership.ledByIdentity;
    const previousIdentity = previous && existingOwnership.find((item) => item.id === previous.id)?.ledByIdentity;
    const isSamePerson = previous && (identity && previousIdentity
      ? identity === previousIdentity
      : normalizedName(previous.name) === normalizedName(incomingAssignee.assignee.name));
    const importedIdentity = {
      ...incomingAssignee.assignee,
      id: previous?.id || incomingAssignee.assignee.id,
      ...(isSamePerson && previous?.memberId ? { memberId: previous.memberId } : {}),
    };
    if (!isSamePerson) delete importedIdentity.memberId;
    const assignee = previous && isUnassignedServicePlanAssignee(previous)
      ? claimServicePlanAssigneeSlot([previous], importedIdentity, {
          preferredSlotId: previous.id,
          reuseSameName: false,
        }).assignee
      : copyServicePlanAssigneeEquipment(importedIdentity, previous);
    return {
      assignee,
      ownership: {
        ...incomingAssignee.ownership,
        id: assignee.id,
        fingerprint: assigneeFingerprint(assignee),
      },
    };
  });

  const ownershipById = new Map<string, NonNullable<NonNullable<ServicePlanElement["servicePlanningImport"]>["managedAssignees"]>[number]>();
  const emitted = new Set<number>();
  let result = existing.flatMap((assignee, index) => {
    const matchedIncoming = [...currentByIncoming.entries()].find(([, currentIndex]) => currentIndex === index)?.[0];
    if (matchedIncoming !== undefined && !operatorOwnedMatches.has(index)) {
      emitted.add(matchedIncoming);
      return [reconciledLedBy[matchedIncoming].assignee];
    }
    if (!ownedOld.has(index)) return [assignee];
    const ownership = existingOwnership.find((item) => item.id === assignee.id);
    if (ownership?.fields.includes("title") && ownership.fingerprint === assigneeFingerprint(assignee)) {
      const titleOwnership = { ...ownership, fields: ["title" as const] };
      delete titleOwnership.ledByIdentity;
      ownershipById.set(assignee.id, titleOwnership);
      return [assignee];
    }
    const equipmentSlot = stripServicePlanAssigneeIdentityPreservingEquipment(assignee);
    return equipmentSlot ? [equipmentSlot] : [];
  });
  existingOwnership.forEach((ownership) => {
    const assignee = result.find((item) => item.id === ownership.id);
    if (assignee && ownership.fingerprint === assigneeFingerprint(assignee) && !ownershipById.has(ownership.id)) ownershipById.set(ownership.id, ownership);
  });
  reconciledLedBy.forEach((item, index) => {
    const currentIndex = currentByIncoming.get(index);
    if (currentIndex !== undefined && operatorOwnedMatches.has(currentIndex)) return;
    ownershipById.set(item.assignee.id, item.ownership);
  });
  [...reconciledLedBy.filter((_, index) => !emitted.has(index)), ...incomingTitle].forEach((incomingItem) => {
    const incomingAssignee = incomingItem.assignee;
    const duplicate = result.find((assignee) => normalizedName(assignee.name) === normalizedName(incomingAssignee.name));
    if (duplicate) {
      const prior = ownershipById.get(duplicate.id);
      if (!prior) return; // Reuse a manual same-name row without claiming it.
      // Older imports appended a source person beside a blank template slot.
      // Repair only when saved provenance still identifies that exact row.
      if (incomingItem.ownership.fields.includes("title") && prior.fields.includes("title") &&
        prior.fingerprint === assigneeFingerprint(duplicate) && !hasServicePlanAssigneeEquipment(duplicate)) {
        const repaired = claimServicePlanAssigneeSlot(result, incomingAssignee, { replaceAssigneeId: duplicate.id, reuseSameName: false });
        if (repaired.claimedSlot) {
          result = repaired.assignees;
          ownershipById.delete(duplicate.id);
          ownershipById.set(repaired.assignee.id, {
            ...incomingItem.ownership,
            id: repaired.assignee.id,
            fields: [...new Set([...prior.fields, ...incomingItem.ownership.fields])],
            fingerprint: assigneeFingerprint(repaired.assignee),
          });
          return;
        }
      }
      const fields = [...new Set([...(prior?.fields || []), ...incomingItem.ownership.fields])];
      ownershipById.set(duplicate.id, {
        ...incomingItem.ownership,
        id: duplicate.id,
        fields,
        fingerprint: assigneeFingerprint(duplicate),
      });
      return;
    }
    const placed = claimServicePlanAssigneeSlot(result, incomingAssignee);
    result = placed.assignees;
    ownershipById.set(placed.assignee.id, { ...incomingItem.ownership, id: placed.assignee.id, fingerprint: assigneeFingerprint(placed.assignee) });
  });
  // A prior append-only title person can remain beside the same imported
  // person after Led By reconciliation has already claimed the equipment row.
  // Merge only when both rows still have verified source provenance.
  existingOwnership.forEach((ownership) => {
    if (!ownership.fields.includes("title")) return;
    const oldPerson = result.find((assignee) => assignee.id === ownership.id);
    if (!oldPerson || hasServicePlanAssigneeEquipment(oldPerson) || ownership.fingerprint !== assigneeFingerprint(oldPerson)) return;
    const replacement = result.find((assignee) => assignee.id !== oldPerson.id &&
      normalizedName(assignee.name) === normalizedName(oldPerson.name) && ownershipById.has(assignee.id));
    if (!replacement) return;
    const replacementOwnership = ownershipById.get(replacement.id)!;
    result = result.filter((assignee) => assignee !== oldPerson);
    ownershipById.delete(oldPerson.id);
    ownershipById.set(replacement.id, {
      ...replacementOwnership,
      fields: [...new Set([...replacementOwnership.fields, ...ownership.fields])],
      fingerprint: assigneeFingerprint(replacement),
    });
  });
  return {
    assignees: result,
    managedAssignees: [...ownershipById.values()].filter((ownership) =>
      result.some((assignee) => assignee.id === ownership.id && ownership.fingerprint === assigneeFingerprint(assignee)),
    ),
  };
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

const reconcileImportedSourceNotes = (
  current: ServicePlanElement,
  imported: ServicePlanElement,
  previousSourceNote: string,
): { notes?: ServicePlanElement["notes"]; managedNotes: NonNullable<ServicePlanElement["servicePlanningImport"]>["managedNotes"]; conflict: boolean } => {
  const currentBlocks = current.notes?.blocks || [];
  const incomingBlocks = imported.notes?.blocks || [];
  const owned = current.servicePlanningImport?.managedNotes || [];
  if (!owned.length && !previousSourceNote.trim() && sameRichText(current.notes, imported.notes)) {
    return { notes: current.notes, managedNotes: [], conflict: false };
  }
  if (!owned.length && previousSourceNote.trim() && currentBlocks.length) {
    return { notes: current.notes, managedNotes: owned, conflict: true };
  }
  const ownedById = new Map(owned.map((item) => [item.id, item]));
  const ownedIndexes = currentBlocks.flatMap((block, index) => ownedById.has(block.id || "") ? [index] : []);
  const currentOwnedOrder = ownedIndexes.map((index) => currentBlocks[index].id);
  const savedOwnedOrder = owned.map((item) => item.id);
  const exactOwnedBlocks = owned.length === ownedIndexes.length && owned.every((item) => {
    const block = currentBlocks.find((candidate) => candidate.id === item.id);
    return block && servicePlanNoteFingerprint(block) === item.fingerprint;
  }) && JSON.stringify(currentOwnedOrder) === JSON.stringify(savedOwnedOrder);
  if (owned.length && !exactOwnedBlocks) {
    return { notes: current.notes, managedNotes: owned, conflict: true };
  }

  const replacements = incomingBlocks.map((block, index) => ({
    ...block,
    id: owned[index]?.id || block.id || generateRandomId(),
  }));
  const replacementByOldIndex = new Map<number, (typeof replacements)[number]>();
  ownedIndexes.forEach((blockIndex, index) => {
    const replacement = replacements[index];
    if (replacement) replacementByOldIndex.set(blockIndex, replacement);
  });
  const lastOwnedIndex = ownedIndexes.at(-1);
  const retained = currentBlocks.flatMap((block, index) => {
    if (!ownedById.has(block.id || "")) return [block];
    const replacement = replacementByOldIndex.get(index);
    return replacement ? [replacement] : [];
  });
  if (lastOwnedIndex !== undefined && replacements.length > ownedIndexes.length) {
    const priorCount = currentBlocks.slice(0, lastOwnedIndex + 1).filter((block) => !ownedById.has(block.id || "")).length;
    retained.splice(priorCount + ownedIndexes.length, 0, ...replacements.slice(ownedIndexes.length));
  } else if (!owned.length && (!previousSourceNote.trim() || !currentBlocks.length)) {
    retained.push(...replacements);
  }
  const managedNotes = replacements.flatMap((block) => block.id
    ? [{ id: block.id, fingerprint: servicePlanNoteFingerprint(block) }]
    : []);
  return {
    ...(retained.length ? { notes: { blocks: retained } } : {}),
    managedNotes,
    conflict: false,
  };
};

const SOURCE_NOTE_CONFLICT_REASON = "The external Note changed, but existing Notes lack reliable source provenance or were edited locally. Review Notes before applying the update.";

const sourceNoteFingerprint = (note: string) => JSON.stringify(normalizedSourceValue(note));

const servicePlanNotesFingerprint = (element: ServicePlanElement) => {
  const serialized = servicePlanNoteFingerprint({ blocks: element.notes?.blocks || [] });
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  return `${serialized.length.toString(36)}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
};

/** Apply an explicit choice for a source-note conflict without guessing note ownership. */
export const resolveServicePlanImportNoteConflict = (
  element: ServicePlanElement,
  resolution: "keepExisting" | "useUpdated",
): ServicePlanElement => {
  const ambiguity = element.importAmbiguity;
  const conflict = ambiguity?.sourceNoteConflict;
  if (!ambiguity || !conflict) return element;

  const sourceNote = element.servicePlanningImport?.observed.note ?? ambiguity.sourceNote ?? "";
  const currentBlocks = element.notes?.blocks || [];
  const managedNotes = element.servicePlanningImport?.managedNotes || [];
  let nextBlocks = currentBlocks;
  let replacements = sourceNote.trim() ? multilineTextToRichText(sourceNote).blocks : [];
  let nextManagedNotes = managedNotes;

  if (resolution === "useUpdated") {
    if (managedNotes.length) {
      const managedById = new Map(managedNotes.map((managed, index) => [managed.id, { ...managed, index }]));
      const currentById = new Map(currentBlocks.flatMap((block) => block.id ? [[block.id, block] as const] : []));
      replacements = replacements.map((block, index) => {
        const prior = managedNotes[index];
        const existing = prior ? currentById.get(prior.id) : undefined;
        const unchanged = Boolean(existing && servicePlanNoteFingerprint(existing) === prior?.fingerprint);
        const id = prior && (!existing || unchanged)
          ? prior.id
          : block.id && !currentById.has(block.id) ? block.id : generateRandomId();
        return { ...block, id };
      });
      const placedSourceIndexes = new Set<number>();
      nextBlocks = currentBlocks.flatMap((block) => {
        const managed = block.id ? managedById.get(block.id) : undefined;
        if (!managed) return [block];
        const unchanged = servicePlanNoteFingerprint(block) === managed.fingerprint;
        const replacement = replacements[managed.index];
        if (!unchanged) {
          // A tracked paragraph edited locally remains operator-owned. Keep it
          // beside the explicitly accepted source update instead of deleting it.
          if (!replacement) return [block];
          placedSourceIndexes.add(managed.index);
          return [block, replacement];
        }
        if (!replacement) return [];
        placedSourceIndexes.add(managed.index);
        return [replacement];
      });
      nextBlocks.push(...replacements.filter((_, index) => !placedSourceIndexes.has(index)));
    } else {
      replacements = replacements.map((block) => ({
        ...block,
        id: block.id || generateRandomId(),
      }));
      // With no note provenance, the operator explicitly chose to replace the
      // full note document. The review shows the existing content and warns
      // about this consequence before this action is available.
      nextBlocks = replacements;
    }
    nextManagedNotes = replacements.flatMap((block) => block.id &&
      richTextToPlainText({ blocks: [block] }).trim()
      ? [{ id: block.id, fingerprint: servicePlanNoteFingerprint(block) }]
      : []);
  }

  const next: ServicePlanElement = { ...element };
  if (nextBlocks.length) next.notes = { blocks: nextBlocks };
  else delete next.notes;
  if (resolution === "useUpdated" && sourceNote.trim()) next.sourceNoteRaw = sourceNote;
  else if (resolution === "useUpdated") delete next.sourceNoteRaw;

  if (element.servicePlanningImport) {
    const state = element.servicePlanningImport;
    const applied = resolution === "useUpdated"
      ? { ...state.applied, note: sourceNote }
      : state.applied;
    const pendingFields = (["elementType", "title", "ledBy", "note"] as const)
      .filter((field) => !sameSourceValue(state.observed[field], applied[field]));
    next.servicePlanningImport = {
      ...state,
      applied,
      pendingFields,
      ...(nextManagedNotes.length ? { managedNotes: nextManagedNotes } : {}),
    };
    if (!nextManagedNotes.length) delete next.servicePlanningImport.managedNotes;
  }

  const reasons = ambiguity.reasons.filter((reason) => reason !== SOURCE_NOTE_CONFLICT_REASON);
  const unresolved = ambiguity.authorizationPending || ambiguity.parts.length > 0 ||
    Boolean(ambiguity.songMappings?.some((mapping) => !mapping.resolution)) || reasons.length > 0;
  next.importAmbiguity = {
    ...ambiguity,
    reasons,
    sourceNoteConflict: {
      sourceFingerprint: sourceNoteFingerprint(sourceNote),
      existingNotesFingerprint: servicePlanNotesFingerprint(next),
      resolution,
    },
    status: unresolved ? "unresolved" : resolution === "keepExisting" ? "acknowledged" : "confirmed",
  };
  return next;
};

const mergeElement = (
  current: ServicePlanElement,
  imported: ServicePlanElement,
  options: ServicePlanningRefreshOptions,
): ServicePlanElement => {
  let next: ServicePlanElement = { ...current, sourcePlanningManaged: true };
  if (imported.sourceOccurrenceId && current.sourceOccurrenceId !== imported.sourceOccurrenceId) {
    next.sourceOccurrenceId = imported.sourceOccurrenceId;
  }
  if (imported.planningCenterPdfMatchKey !== undefined) {
    next.planningCenterPdfMatchKey = imported.planningCenterPdfMatchKey;
  }
  if (imported.planningCenterPdfSourcePosition !== undefined) {
    next.planningCenterPdfSourcePosition = imported.planningCenterPdfSourcePosition;
  }
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
  const changedObservedNote = options.updateNotes && !sameSourceValue(currentState.applied.note, observed.note);
  const priorNoteDecision = current.importAmbiguity?.sourceNoteConflict;
  const acknowledgedKeep = priorNoteDecision?.resolution === "keepExisting" &&
    priorNoteDecision.sourceFingerprint === sourceNoteFingerprint(observed.note) &&
    priorNoteDecision.existingNotesFingerprint === servicePlanNotesFingerprint(current);
  const noteReconciliation = changedObservedNote && !acknowledgedKeep
    ? reconcileImportedSourceNotes(current, imported, currentState.applied.note)
    : undefined;
  const noteUpdateConflict = Boolean(noteReconciliation?.conflict);
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
  if (changedObservedNote && !noteUpdateConflict && !acknowledgedKeep) {
    applied.note = observed.note;
  }
  const pendingFields = (["elementType", "title", "ledBy", "note"] as const)
    .filter((field) => !sameSourceValue(observed[field], applied[field]));
  next.servicePlanningImport = {
    observed, applied, pendingFields,
    ...(currentState.managedAssignees?.length ? { managedAssignees: currentState.managedAssignees } : {}),
    ...((noteReconciliation?.managedNotes || currentState.managedNotes)?.length
      ? { managedNotes: noteReconciliation?.managedNotes || currentState.managedNotes }
      : {}),
  };
  const changedAcceptedTitle = options.updateTitles && (
    !sameSourceValue(currentState.applied.title, observed.title) ||
    !sameSourceValue(currentState.applied.elementType, observed.elementType)
  );
  const changedAcceptedNote = changedObservedNote && !noteUpdateConflict && !acknowledgedKeep;
  const changedAcceptedTitleOrNote = changedAcceptedTitle || changedAcceptedNote;
  const confirmed = current.importAmbiguity?.status === "confirmed" ||
    current.importAmbiguity?.status === "acknowledged";
  const preserveConfirmedTitle = confirmed && !changedAcceptedTitle;
  // A title can contain a person suggestion whose destination was explicitly
  // changed during review. Keep that assignee choice intact until the source
  // changes are reviewed; Led By still follows its own refresh option.
  const preserveConfirmedNotes = confirmed && !changedObservedNote;
  if (options.updateTitles) {
    if (!preserveConfirmedTitle) {
      next = {
        ...next,
        type: imported.type,
        ...(!sameRichText(current.title, imported.title)
          ? { title: imported.title }
          : {}),
      };
    }
    // A refresh must not undo song linking: once a slot points at a real
    // library song, an unmatched ("pending") ref from the source is the weaker
    // of the two, so the operator's link stays. Check every song slot — a
    // worship set can keep a later library link even when an earlier one is
    // still pending.
    const currentSongRefs = getServicePlanElementSongRefs(current);
    const reconciledSongs = reconcileImportedSongRefs(current, imported);
    const mergedSongRefs = current.sourceTemplateElementId &&
      getServicePlanElementSongRefs(imported).length === 0
      ? currentSongRefs
      : reconciledSongs.refs;
    const songRefsUnchanged =
      mergedSongRefs.length === currentSongRefs.length &&
      mergedSongRefs.every((ref, index) => ref === currentSongRefs[index]);
    if (!songRefsUnchanged) {
      next.songRefs = mergedSongRefs;
      delete next.songRef;
    }
    if (current.sourceSongReferenceDismissed) {
      if (dismissedSourceSongStillMatches(current, imported)) {
        next.songRefs = [];
        delete next.songRef;
      } else {
        delete next.sourceSongReferenceDismissed;
        delete next.sourceSongReferenceDismissedFingerprint;
        delete next.sourceSongReferenceDismissedOccurrenceId;
      }
    }
    if (reconciledSongs.songMappings?.length) {
      const ambiguity = next.importAmbiguity || imported.importAmbiguity || {
        source: "servicePlanning" as const,
        sourceKey: imported.servicePlanningImport?.observed.title || "song-reference",
        sourceElementType: imported.sourceElementTypeRaw || "Song",
        sourceTitle: imported.sourceContentTitleRaw || richTextToPlainText(imported.title),
        sourceLedBy: imported.sourceLedByRaw || "",
        parts: [],
        reasons: [],
        status: "unresolved" as const,
        sourceFingerprint: "",
      };
      const oldMappings = current.importAmbiguity?.songMappings || [];
      const sameMapping = (left: ImportedSongMapping, right: ImportedSongMapping) =>
        (left.mappingId === right.mappingId || (
          !left.mappingId && oldMappings.filter((mapping) =>
            !mapping.mappingId && mapping.sourceFingerprint === left.sourceFingerprint,
          ).length === 1
        )) && left.sourceFingerprint === right.sourceFingerprint &&
        sameOccurrenceIds(left.candidateOccurrenceIds, right.candidateOccurrenceIds);
      const unchangedMappings = reconciledSongs.songMappings.length === oldMappings.length &&
        reconciledSongs.songMappings.every((mapping) =>
          oldMappings.some((old) => sameMapping(old, mapping) &&
            JSON.stringify(old.resolution) === JSON.stringify(mapping.resolution)),
        );
      const hasUnresolvedMapping = reconciledSongs.songMappings.some((mapping) => !mapping.resolution);
      next.importAmbiguity = {
        ...ambiguity,
        // Use reconciled records so a safe legacy match is upgraded with its
        // stable identity, while ambiguous legacy records receive no decision.
        songMappings: reconciledSongs.songMappings,
        reasons: [...new Set([...ambiguity.reasons, "A pending song matches multiple linked library songs."])],
        status: unchangedMappings && current.importAmbiguity && current.importAmbiguity.status !== "unresolved"
          ? hasUnresolvedMapping && current.importAmbiguity.status !== "deferred"
            ? "unresolved"
            : current.importAmbiguity.status
          : "unresolved",
      };
    } else if (current.importAmbiguity?.songMappings?.length) {
      const incomingFingerprints = new Set(getServicePlanElementSongRefs(imported).flatMap((ref) => ref.kind === "pending"
        ? [JSON.stringify([normalized(ref.title), normalizedLyrics(ref.lyricsText), normalized(ref.key || "")])]
        : [],
      ));
      // A saved decision belongs to the incoming song meaning it reviewed. Keep
      // resolved records on an unchanged source, and discard records whose song
      // meaning disappeared or changed during this refresh.
      const retainedMappings = current.importAmbiguity.songMappings.filter((mapping) =>
        Boolean(mapping.resolution) && incomingFingerprints.has(mapping.sourceFingerprint),
      );
      if (retainedMappings.length !== current.importAmbiguity.songMappings.length) {
        const reasons = current.importAmbiguity.reasons.filter((reason) =>
          reason !== "A pending song matches multiple linked library songs." || retainedMappings.length > 0,
        );
        const nextAmbiguity = {
          ...(next.importAmbiguity || current.importAmbiguity),
          ...(retainedMappings.length ? { songMappings: retainedMappings } : {}),
          reasons,
          ...(current.importAmbiguity.status === "unresolved" &&
            !current.importAmbiguity.parts.length && !reasons.length
            ? { status: "confirmed" as const }
            : {}),
        };
        if (!retainedMappings.length) delete nextAmbiguity.songMappings;
        next.importAmbiguity = nextAmbiguity;
      }
    }
    if (!preserveConfirmedTitle) {
      if (normalized(current.sourceElementTypeRaw || "") !== normalized(imported.sourceElementTypeRaw || "")) {
        next = copyOptionalField(next, imported, "sourceElementTypeRaw");
      }
      if (!sameSourceValue(current.sourceContentTitleRaw || "", imported.sourceContentTitleRaw || "")) {
        next = copyOptionalField(next, imported, "sourceContentTitleRaw");
      }
    }
  }
  if (options.updateAssignments) {
    const reconciledAssignees = reconcileImportedSourceAssignees(
      current,
      imported,
      currentState.applied.ledBy,
    );
    if (JSON.stringify(reconciledAssignees.assignees) !== JSON.stringify(getServicePlanElementAssignees(current))) {
      next.assignees = reconciledAssignees.assignees;
    }
    if (reconciledAssignees.managedAssignees?.length) next.servicePlanningImport = { ...next.servicePlanningImport!, managedAssignees: reconciledAssignees.managedAssignees };
    else if (next.servicePlanningImport) delete next.servicePlanningImport.managedAssignees;
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
    // An absent source time means "no timing supplied", not "clear the
    // existing schedule". Planning Center PDFs normally provide durations only.
    if (imported.startTime?.trim() && normalizedStartTime(current.startTime) !== normalizedStartTime(imported.startTime)) {
      next = copyOptionalField(next, imported, "startTime");
    }
    const hasImportedDuration = typeof imported.durationSeconds === "number" ||
      typeof imported.durationMinutes === "number";
    const currentDurationSeconds = current.durationSeconds ?? (current.durationMinutes ?? 0) * 60;
    const importedDurationSeconds = imported.durationSeconds ?? (imported.durationMinutes ?? 0) * 60;
    if (hasImportedDuration && currentDurationSeconds !== importedDurationSeconds) {
      next = copyOptionalField(next, imported, "durationSeconds");
      next = copyOptionalField(next, imported, "durationMinutes");
    }
  }
  if (options.updateNotes && changedAcceptedNote && noteReconciliation && !preserveConfirmedNotes) {
    if (!sameRichText(current.notes, noteReconciliation.notes)) {
      if (noteReconciliation.notes) next.notes = noteReconciliation.notes;
      else delete next.notes;
    }
    if (!sameSourceValue(current.sourceNoteRaw || "", imported.sourceNoteRaw || "")) {
      next = copyOptionalField(next, imported, "sourceNoteRaw");
    }
  }
  if (options.updateNotes && !preserveConfirmedNotes) {
    const localRoleNotes = (current.teamNotes || []).filter((note) => note.scope === "role");
    const importedTeamNotes = preserveImportedTeamNoteIds(
      current.teamNotes || [],
      (imported.teamNotes || []).filter((note) => note.scope !== "role"),
    );
    const nextNotes = [...importedTeamNotes, ...localRoleNotes];
    if (nextNotes.length) next.teamNotes = nextNotes;
    else delete next.teamNotes;
  }

  if (changedAcceptedTitleOrNote) {
    const acceptedFields = new Set<"title" | "note" | "ledBy">([
      ...(changedAcceptedTitle ? ["title" as const] : []),
      ...(changedAcceptedNote ? ["note" as const] : []),
    ]);
    const reconciled = reconcileReviewedServicePlanParts(next, imported, acceptedFields);
    next = reconciled.element;
    if (reconciled.ambiguity) next.importAmbiguity = reconciled.ambiguity;
  }

  // Reconcile interpretation metadata independently from destination updates.
  // A declined title or note remains observed and pending, never applied later
  // just because another refresh happens to enable that field.
  const currentAmbiguity = current.importAmbiguity;
  const importedAmbiguity = imported.importAmbiguity;
  if (!changedAcceptedTitleOrNote) {
    if (currentAmbiguity) {
      const nextSongMappings = next.importAmbiguity?.songMappings;
      const previousMappings = currentAmbiguity.songMappings || [];
      const songMappingChanged = nextSongMappings !== undefined && (
        nextSongMappings.length !== previousMappings.length ||
        nextSongMappings.some((mapping, index) => {
          const previous = previousMappings[index];
          return !previous || mapping.sourceFingerprint !== previous.sourceFingerprint ||
            !sameOccurrenceIds(mapping.candidateOccurrenceIds, previous.candidateOccurrenceIds) ||
            JSON.stringify(mapping.resolution) !== JSON.stringify(previous.resolution);
        })
      );
      next.importAmbiguity = {
        ...currentAmbiguity,
        sourceElementType: importedAmbiguity?.sourceElementType ?? observed.elementType,
        sourceTitle: importedAmbiguity?.sourceTitle ?? observed.title,
        sourceLedBy: importedAmbiguity?.sourceLedBy ?? observed.ledBy,
        ...(observed.note ? { sourceNote: observed.note } : {}),
        sourceFingerprint: importedAmbiguity?.sourceFingerprint || currentAmbiguity.sourceFingerprint,
        ...(nextSongMappings ? { songMappings: nextSongMappings } : {}),
        ...(songMappingChanged ? {
          reasons: next.importAmbiguity?.reasons || currentAmbiguity.reasons,
          status: "unresolved" as const,
        } : {}),
      };
    }
  } else if (importedAmbiguity || currentAmbiguity || next.importAmbiguity) {
    const reconciledAmbiguity = next.importAmbiguity;
    const interpretationBase = importedAmbiguity || currentAmbiguity || reconciledAmbiguity!;
    const acceptedFields = new Set([
      ...(changedAcceptedTitle ? ["title"] : []),
      ...(changedAcceptedNote ? ["note"] : []),
    ]);
    const retainedParts = (currentAmbiguity?.parts || []).filter((part) =>
      !acceptedFields.has(part.sourceField || "title"),
    );
    const acceptedParts = (importedAmbiguity?.parts || []).filter((part) =>
      acceptedFields.has(part.sourceField || "title"),
    );
    const parts = [...retainedParts, ...acceptedParts].map((part) => {
      const reconciledPart = reconciledAmbiguity?.parts.find((candidate) =>
        candidate.kind === part.kind && candidate.value === part.value &&
        (candidate.sourceField || "title") === (part.sourceField || "title"),
      );
      return reconciledPart || part;
    });
    const songMappings = reconciledAmbiguity?.songMappings ?? currentAmbiguity?.songMappings;
    const unresolvedSongMapping = songMappings?.some((mapping) => !mapping.resolution) || false;
    const previousMappings = currentAmbiguity?.songMappings || [];
    const deferredMappingUnchanged = currentAmbiguity?.status === "deferred" &&
      Boolean(songMappings) && songMappings!.length === previousMappings.length &&
      songMappings!.every((mapping, index) => {
        const previous = previousMappings[index];
        return previous && mapping.sourceFingerprint === previous.sourceFingerprint &&
          sameOccurrenceIds(mapping.candidateOccurrenceIds, previous.candidateOccurrenceIds) &&
          JSON.stringify(mapping.resolution) === JSON.stringify(previous.resolution);
      });
    const interpretationUnresolved = importedAmbiguity?.status === "unresolved" ||
      (reconciledAmbiguity?.status === "unresolved" && reconciledAmbiguity.reasons.some((reason) =>
        reason.includes("source-managed attachment was edited locally"),
      )) ||
      (parts.length > 0 && currentAmbiguity?.status === "unresolved");
    const reasons = [...new Set([
      ...(importedAmbiguity?.reasons || (retainedParts.length ? currentAmbiguity?.reasons || [] : [])),
      ...(reconciledAmbiguity?.reasons || []).filter((reason) =>
        reason.includes("pending song matches multiple linked library songs") && unresolvedSongMapping,
      ),
    ])];
    if (!parts.length && !songMappings?.length && !reasons.length) {
      delete next.importAmbiguity;
    } else {
      const status = (unresolvedSongMapping && !deferredMappingUnchanged) || interpretationUnresolved
        ? "unresolved"
        : deferredMappingUnchanged || (currentAmbiguity?.status === "deferred" && !importedAmbiguity)
          ? "deferred"
          : importedAmbiguity?.status === "acknowledged" || currentAmbiguity?.status === "acknowledged"
            ? "acknowledged"
            : "confirmed";
      next.importAmbiguity = {
        ...interpretationBase,
        ...(reconciledAmbiguity || {}),
        ...(songMappings ? { songMappings } : {}),
        parts,
        reasons,
        status,
      };
    }
  } else if (currentAmbiguity && changedAcceptedTitleOrNote) {
    delete next.importAmbiguity;
  }
  if (noteUpdateConflict) {
    const base = next.importAmbiguity || importedAmbiguity || currentAmbiguity || {
      source: "servicePlanning" as const,
      sourceKey: imported.importAmbiguity?.sourceKey || "",
      sourceElementType: observed.elementType,
      sourceTitle: observed.title,
      sourceLedBy: observed.ledBy,
      parts: [],
      reasons: [],
      status: "unresolved" as const,
      sourceFingerprint: JSON.stringify(observed),
    };
    next.importAmbiguity = {
      ...base,
      sourceNote: observed.note,
      reasons: [...new Set([...base.reasons, SOURCE_NOTE_CONFLICT_REASON])],
      sourceNoteConflict: {
        sourceFingerprint: sourceNoteFingerprint(observed.note),
        existingNotesFingerprint: servicePlanNotesFingerprint(current),
      },
      status: "unresolved",
    };
  }
  const upgraded = upgradeLegacyImportedDescriptionTitles(next, imported);
  upgraded.type = getServicePlanElementType(upgraded);
  return upgraded;
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

/**
 * Reconciles a fresh Service Planning parse into an editable plan without
 * replacing locally-created IDs, notes, roster links, or outline-push state.
 * It resolves associations before merging fields. PDFs express their desired
 * source sequence here; summary turns relative differences into operations.
 * Other imports retain order and place only additions and section moves.
 */
export const refreshServicePlanFromImport = (
  currentSections: ServicePlanSection[],
  importedSections: ServicePlanSection[],
  options: ServicePlanningRefreshOptions,
): ServicePlanSection[] => {
  const tracksSource = planTracksSource(currentSections);
  const owned = (element: ServicePlanElement) => Boolean(element.sourcePlanningManaged) ||
    (!tracksSource && Boolean(options.treatUnmarkedItemsAsSource));
  const identity = (element: ServicePlanElement) => getElementImportIdentity(element, options.planningCenterPdfMatch);
  const label = (element: ServicePlanElement) => options.planningCenterPdfMatch
    ? [getPlanningCenterPdfMatchingTitle(element)]
    : [richTextToPlainText(element.title), element.sourceElementTypeRaw || "", element.sourceContentTitleRaw || ""];
  const templateKey = (element: ServicePlanElement) => JSON.stringify([
    element.sourceTemplateElementType || element.type, normalized(richTextToPlainText(element.title)),
  ]);
  const current = currentSections.flatMap((section, sectionIndex) =>
    section.elements.map((element) => ({ element, sectionIndex })));
  const incoming = importedSections.flatMap((section, sectionIndex) =>
    section.elements.map((element) => ({ element, sectionIndex })));
  const sectionPairs = pairByLabelThenOrder(currentSections, importedSections, (section) => section.name,
    (section) => Boolean(section.sourcePlanningManaged) || !tracksSource, () => false);
  const destinationBySourceSection = new Map(sectionPairs.map(([existing, source]) => [source.index, existing.index]));
  const sourceByCurrentSection = new Map(sectionPairs.map(([existing, source]) => [existing.index, source.index]));
  const byIdentity = (items: typeof current) => {
    const result = new Map<string, typeof current>();
    items.forEach((item) => {
      const key = identity(item.element);
      if (key) result.set(key, [...(result.get(key) || []), item]);
    });
    return result;
  };
  const currentIdentities = byIdentity(current);
  const incomingIdentities = byIdentity(incoming);
  const ambiguousIdentities = new Set([...incomingIdentities].flatMap(([key, items]) =>
    items.length > 1 || (currentIdentities.get(key)?.length || 0) > 1 ? [key] : []));
  const protectedIds = new Set(current.flatMap(({ element }) => {
    const conflictingIdentity = element.sourceOccurrenceId && !incomingIdentities.has(element.sourceOccurrenceId) && incoming.some(({ element: source }) =>
      source.sourceOccurrenceId && source.sourceOccurrenceId !== element.sourceOccurrenceId &&
      templateKey(source) === templateKey(element));
    return conflictingIdentity || ambiguousIdentities.has(identity(element) || "") ||
      (options.planningCenterPdfMatch && element.planningCenterPdfMatchReviewRequired && !element.sourceOccurrenceId)
      ? [element.id] : [];
  }));
  type Association = { current: typeof current[number]; review: boolean };
  const associations = new Map<ServicePlanElement, Association>();
  const claimed = new Set<string>();
  const associate = (source: ServicePlanElement, existing: typeof current[number], review = false) => {
    if (claimed.has(existing.element.id)) return;
    associations.set(source, { current: existing, review });
    claimed.add(existing.element.id);
    if (review) protectedIds.add(existing.element.id);
  };
  // Reserve uncertain suggestions before every automatic pass.
  incoming.forEach(({ element }) => {
    const candidate = current.find((item) => item.element.id === element.legacyImportMatchCandidateForId);
    if (candidate) associate(element, candidate, true);
  });
  incoming.forEach(({ element }) => {
    if (associations.has(element) || element.legacyImportMatchCandidateForId) return;
    const resolved = element.importMatchCurrentId
      ? current.find((item) => item.element.id === element.importMatchCurrentId) : undefined;
    if (resolved && !protectedIds.has(resolved.element.id)) {
      associate(element, resolved);
      return;
    }
    const key = identity(element);
    const matches = key ? currentIdentities.get(key) || [] : [];
    if (key && !ambiguousIdentities.has(key) && matches.length === 1 &&
      !protectedIds.has(matches[0].element.id)) associate(element, matches[0]);
  });
  // Template provenance and legacy confirmations use globally unique title/type
  // evidence. An explicit conflicting identity is never replaced by a title.
  incoming.forEach(({ element }) => {
    if (associations.has(element) || ambiguousIdentities.has(identity(element) || "")) return;
    const key = templateKey(element);
    if (incoming.filter((item) => templateKey(item.element) === key).length !== 1) return;
    const templateMatches = current.filter((item) => item.element.sourceTemplateElementId &&
      !identity(item.element) && templateKey(item.element) === key);
    if (templateMatches.length === 1) {
      associate(element, templateMatches[0]);
      return;
    }
    if (!options.suggestLegacyMatches || (identity(element) && currentIdentities.has(identity(element)!))) return;
    const legacyMatches = current.filter((item) => !item.element.sourcePlanningManaged &&
      !item.element.sourceTemplateElementId && !identity(item.element) && templateKey(item.element) === key);
    if (legacyMatches.length === 1) associate(element, legacyMatches[0], true);
  });
  // Section-local label matching is the final association pass. The residual
  // positional fallback belongs only to the existing non-PDF import contract.
  sectionPairs.forEach(([existing, source]) => {
    const available = existing.value.elements.filter((element) => !claimed.has(element.id) &&
      !protectedIds.has(element.id));
    const sources = source.value.elements.filter((element) => !associations.has(element) &&
      !element.legacyImportMatchCandidateForId && !ambiguousIdentities.has(identity(element) || ""));
    pairByLabelThenOrder(available, sources, label,
      (element) => (element.sourcePlanningManaged || !tracksSource) &&
        (!options.suggestLegacyMatches || Boolean(element.sourcePlanningManaged || element.sourceTemplateElementId)),
      (element) => !options.planningCenterPdfMatch && owned(element) &&
        (!options.suggestLegacyMatches || Boolean(element.sourcePlanningManaged || element.sourceTemplateElementId)),
      identity,
    ).forEach(([existingItem, sourceItem]) => {
      const item = current.find((item) => item.element === existingItem.value)!;
      associate(sourceItem.value, item);
    });
  });
  const sourceByCurrentId = new Map([...associations].filter(([, match]) => !match.review)
    .map(([element, match]) => [match.current.element.id, element]));
  const pdfEvidenceInUse = new Set(current.flatMap(({ element }) => element.planningCenterPdfMatchKey ? [element.planningCenterPdfMatchKey] : []));
  const merged = new Map(incoming.map(({ element }) => {
    const match = associations.get(element);
    const result = match ? mergeElement(match.current.element, element, options) : managedImportedElement(element);
    // New/confirmed occurrences receive distinct evidence. Never save the
    // colliding temporary fingerprints that made the proposal uncertain.
    if (options.planningCenterPdfMatch && (!match || match.review) && !element.planningCenterPdfMatchKey &&
      incoming.filter((item) => getPlanningCenterPdfMatchingTitle(item.element) === getPlanningCenterPdfMatchingTitle(element)).length > 1) {
      let occurrence = 0;
      const key = () => makePlanningCenterPdfMatchKey(getPlanningCenterPdfMatchingTitle(element),
        element.durationSeconds ?? Math.round((element.durationMinutes || 0) * 60), true, occurrence);
      while (pdfEvidenceInUse.has(key())) occurrence += 1;
      result.planningCenterPdfMatchKey = key();
      pdfEvidenceInUse.add(key());
    }
    return [element, match?.review
      ? { ...result, id: element.id, legacyImportMatchCandidateForId: match.current.element.id }
      : result] as const;
  }));
  const buildSection = (sourceIndex: number, existing?: ServicePlanSection): ServicePlanSection => {
    const source = importedSections[sourceIndex];
    const placements: ServicePlanElement[] = [];
    const elements = (existing?.elements || []).flatMap((element) => {
      const incomingElement = sourceByCurrentId.get(element.id);
      if (incomingElement) {
        const sourceEntry = incoming.find((item) => item.element === incomingElement)!;
        if (sourceEntry.sectionIndex !== sourceIndex) return [];
        return [merged.get(incomingElement)!];
      }
      return options.removeMissing && owned(element) && !protectedIds.has(element.id) ? [] : [element];
    });
    const sourceOrder = source.elements.flatMap((element) => {
      if (ambiguousIdentities.has(identity(element) || "") && !associations.has(element)) return [];
      const match = associations.get(element);
      if (!match && !options.addMissing) return [];
      const result = merged.get(element)!;
      if (!match || match.review || match.current.sectionIndex !== destinationBySourceSection.get(sourceIndex)) {
        placements.push(result);
      }
      return [result];
    });
    if (options.planningCenterPdfMatch) {
      // The resolved IDs, rather than a second title/position match, define the
      // desired source sequence. Reserved and operator rows are never sorted.
      const eligible = new Set(sourceOrder.filter((element) => !element.legacyImportMatchCandidateForId).map(({ id }) => id));
      const ordered = sourceOrder.filter((element) => elements.some(({ id }) => id === element.id) && eligible.has(element.id));
      let index = 0;
      elements.forEach((element, slot) => { if (eligible.has(element.id)) elements[slot] = ordered[index++]; });
    }
    return { ...(existing || source), sourcePlanningManaged: true,
      name: existing && !options.updateTitles ? existing.name : source.name,
      elements: placeServicePlanImportElements(elements, sourceOrder, placements) };
  };
  const result = currentSections.flatMap((section, index) => {
    const sourceIndex = sourceByCurrentSection.get(index);
    if (sourceIndex !== undefined) return [buildSection(sourceIndex, section)];
    const elements = section.elements.filter((element) => !sourceByCurrentId.has(element.id) &&
      (!options.removeMissing || !section.sourcePlanningManaged || !owned(element) || protectedIds.has(element.id)));
    return section.sourcePlanningManaged && options.removeMissing && !elements.length ? [] : [{ ...section, elements }];
  });
  const additions = new Map<number, ServicePlanSection>();
  importedSections.forEach((_, index) => {
    if (destinationBySourceSection.has(index)) return;
    const section = buildSection(index);
    if (section.elements.length) additions.set(index, section);
  });
  return insertNewServicePlanSectionRuns(result, importedSections.length, additions,
    new Map(sectionPairs.map(([existing, source]) => [source.index, existing.value.id])));
};
