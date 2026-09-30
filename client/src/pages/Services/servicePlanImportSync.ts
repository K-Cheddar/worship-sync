import { richTextSemanticEqual, richTextToPlainText } from "../../types/richText";
import {
  getServicePlanElementAssignees,
  getServicePlanElementSongRefs,
} from "../../types/servicePlan";
import generateRandomId from "../../utils/generateRandomId";
import type {
  ServicePlanAssignee,
  ServicePlanElement,
  ServicePlanSection,
  ServicePlanTeamNote,
} from "../../types/servicePlan";
import { insertNewServicePlanSectionRuns } from "./servicePlanImportSectionPlacement";
import { reconcileReviewedServicePlanParts, servicePlanNoteFingerprint } from "./servicePlanImportOwnership";
import { splitServicePlanningLedByNames } from "./servicePlanFromImport";
import { copyServicePlanAssigneeEquipment, hasServicePlanAssigneeEquipment, stripServicePlanAssigneeIdentityPreservingEquipment } from "./servicePlanAssigneeUtils";

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
type ImportedSongMapping = NonNullable<NonNullable<ServicePlanElement["importAmbiguity"]>["songMappings"]>[number];

const normalized = (value: string): string =>
  value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

const normalizedSourceValue = (value: string): string =>
  value.replace(/\r\n?/g, "\n").trim().replace(/\s+/g, " ");

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
): Array<[Indexed<T>, Indexed<T>]> => {
  const availableCurrent = current.map((value, index) => ({ value, index }));
  const availableImported = imported.map((value, index) => ({ value, index }));
  const pairs: Array<[Indexed<T>, Indexed<T>]> = [];
  const usedCurrent = new Set<number>();
  const usedImported = new Set<number>();

  for (const incoming of availableImported) {
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
  acceptTitlePeople: boolean,
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
  const incomingTitle = acceptTitlePeople
    ? getServicePlanElementAssignees(imported).flatMap((assignee) => {
        const ownership = imported.servicePlanningImport?.managedAssignees?.find((item) => item.id === assignee.id);
        return ownership?.fields.includes("title") && !ownership.fields.includes("ledBy") ? [{ assignee, ownership }] : [];
      })
    : [];
  const ownedOld = new Set<number>();
  const currentByIncoming = new Map<number, number>();
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

  const remainingOld = [...ownedOld].filter((index) => !used.has(index));
  const remainingIncoming = incomingLedBy.map((_, index) => index).filter((index) => !currentByIncoming.has(index));
  if (remainingOld.length === remainingIncoming.length) {
    remainingIncoming.forEach((incomingIndex, index) => {
      const oldIndex = remainingOld[index];
      used.add(oldIndex);
      currentByIncoming.set(incomingIndex, oldIndex);
    });
  }

  const reconciledLedBy = incomingLedBy.map((incomingAssignee, index) => {
    const previous = currentByIncoming.get(index) === undefined ? undefined : existing[currentByIncoming.get(index)!];
    const identity = incomingAssignee.ownership.ledByIdentity;
    const previousIdentity = previous && existingOwnership.find((item) => item.id === previous.id)?.ledByIdentity;
    const isSamePerson = previous && (identity && previousIdentity
      ? identity === previousIdentity
      : normalizedName(previous.name) === normalizedName(incomingAssignee.assignee.name));
    const assignee = copyServicePlanAssigneeEquipment({
      ...incomingAssignee.assignee,
      id: previous?.id || incomingAssignee.assignee.id,
      ...(isSamePerson && previous?.memberId ? { memberId: previous.memberId } : {}),
    }, previous);
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
  const result = existing.flatMap((assignee, index) => {
    if (!ownedOld.has(index)) return [assignee];
    const matchedIncoming = [...currentByIncoming.entries()].find(([, currentIndex]) => currentIndex === index)?.[0];
    if (matchedIncoming !== undefined) {
      emitted.add(matchedIncoming);
      return [reconciledLedBy[matchedIncoming].assignee];
    }
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
  reconciledLedBy.forEach((item) => ownershipById.set(item.assignee.id, item.ownership));
  [...reconciledLedBy.filter((_, index) => !emitted.has(index)), ...incomingTitle].forEach((incomingItem) => {
    const incomingAssignee = incomingItem.assignee;
    const duplicate = result.find((assignee) => normalizedName(assignee.name) === normalizedName(incomingAssignee.name));
    if (duplicate) {
      const prior = ownershipById.get(duplicate.id);
      if (!prior && incomingItem.ownership.fields.includes("ledBy")) return;
      const fields = [...new Set([...(prior?.fields || []), ...incomingItem.ownership.fields])];
      ownershipById.set(duplicate.id, {
        ...incomingItem.ownership,
        id: duplicate.id,
        fields,
        fingerprint: assigneeFingerprint(duplicate),
      });
      return;
    }
    result.push(incomingAssignee);
    ownershipById.set(incomingAssignee.id, { ...incomingItem.ownership, id: incomingAssignee.id, fingerprint: assigneeFingerprint(incomingAssignee) });
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

const mergeElement = (
  current: ServicePlanElement,
  imported: ServicePlanElement,
  options: ServicePlanningRefreshOptions,
): ServicePlanElement => {
  let next: ServicePlanElement = { ...current, sourcePlanningManaged: true };
  if (imported.sourceOccurrenceId && current.sourceOccurrenceId !== imported.sourceOccurrenceId) {
    next.sourceOccurrenceId = imported.sourceOccurrenceId;
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
  const noteReconciliation = changedObservedNote
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
  if (changedObservedNote && !noteUpdateConflict) {
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
  const changedAcceptedNote = changedObservedNote && !noteUpdateConflict;
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
    const mergedSongRefs = reconciledSongs.refs;
    const songRefsUnchanged =
      mergedSongRefs.length === currentSongRefs.length &&
      mergedSongRefs.every((ref, index) => ref === currentSongRefs[index]);
    if (!songRefsUnchanged) {
      next.songRefs = mergedSongRefs;
      delete next.songRef;
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
      changedAcceptedTitle,
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
    const reason = "The external Note changed, but existing Notes lack reliable source provenance or were edited locally. Review Notes before applying the update.";
    next.importAmbiguity = {
      ...base,
      sourceNote: observed.note,
      reasons: [...new Set([...base.reasons, reason])],
      status: "unresolved",
    };
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
        (element) => element.sourceOccurrenceId,
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
