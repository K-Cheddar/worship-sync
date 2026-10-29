import type { OverlayInfo } from "../../types";
import type { OverlaySyncPlanItem } from "../../types/servicePlanningImport";
import { normalizeElementTypeForMatch } from "./normalizeElementForMatch";

const MIN_SCORE = 25;
const isParticipantOverlay = (overlay: OverlayInfo): boolean =>
  (overlay.type ?? "participant") === "participant";

export const normalizeOverlayEvent = (event?: string): string =>
  (event || "").toLowerCase().replace(/\s+/g, " ").trim();

/** Reserve exact identities across the whole batch before consuming event slots.
 * Current-list order wins ties; library-only targets are copied, never edited.
 * Reused by preview, run preparation, and the current-state readiness check.
 */
export const planNativeOverlaySync = (
  plan: OverlaySyncPlanItem[],
  current: OverlayInfo[],
  library: OverlayInfo[] = [],
): OverlaySyncPlanItem[] => {
  const currentIds = new Set(current.map((overlay) => overlay.id));
  const currentParticipants = current.filter(isParticipantOverlay);
  const libraryParticipants = library
    .filter((overlay) => !currentIds.has(overlay.id) && isParticipantOverlay(overlay));
  const claimedCurrentIds = new Set<string>();
  const claimedLibraryIds = new Set<string>();
  const targets = new Map<number, { overlay: OverlayInfo; source: "current" | "library" }>();
  const candidateIndexes = plan.flatMap((item, index) =>
    item.sourceKind === "native" && item.action !== "skip" ? [index] : [],
  );
  const sameEvent = (item: OverlaySyncPlanItem, overlay: OverlayInfo) =>
    Boolean(normalizeOverlayEvent(item.patch.event)) &&
    normalizeOverlayEvent(item.patch.event) === normalizeOverlayEvent(overlay.event);
  const sameParticipant = (item: OverlaySyncPlanItem, overlay: OverlayInfo) => {
    const name = normalizeOverlayEvent(item.patch.name);
    return Boolean(name) && name === normalizeOverlayEvent(overlay.name) &&
      (!item.isSong || normalizeOverlayEvent(item.patch.title) === normalizeOverlayEvent(overlay.title));
  };
  const sameSong = (item: OverlaySyncPlanItem, overlay: OverlayInfo) => {
    const title = normalizeOverlayEvent(item.patch.title);
    return item.isSong === true && Boolean(title) && title === normalizeOverlayEvent(overlay.title);
  };

  const assignMatches = (
    indexes: number[],
    overlays: OverlayInfo[],
    claimedIds: Set<string>,
    source: "current" | "library",
    matches: (item: OverlaySyncPlanItem, overlay: OverlayInfo) => boolean,
  ) => {
    for (const index of indexes) {
      const item = plan[index];
      if (targets.has(index)) continue;
      const target = overlays.find((overlay) =>
        !claimedIds.has(overlay.id) && sameEvent(item, overlay) && matches(item, overlay),
      );
      if (!target) continue;
      targets.set(index, { overlay: target, source });
      claimedIds.add(target.id);
    }
  };

  // Reserve specific current-list matches across the whole batch before the
  // plan-order event-slot fallback can claim them for another participant.
  assignMatches(candidateIndexes, currentParticipants, claimedCurrentIds, "current", sameParticipant);
  assignMatches(candidateIndexes, currentParticipants, claimedCurrentIds, "current", sameSong);
  assignMatches(candidateIndexes, currentParticipants, claimedCurrentIds, "current", () => true);

  const remainingIndexes = candidateIndexes.filter((index) => !targets.has(index));
  // Library entries are clone templates only. They are considered after every
  // suitable current-list slot has been assigned and are never edited in place.
  assignMatches(remainingIndexes, libraryParticipants, claimedLibraryIds, "library", sameParticipant);
  assignMatches(remainingIndexes, libraryParticipants, claimedLibraryIds, "library", sameSong);
  assignMatches(remainingIndexes, libraryParticipants, claimedLibraryIds, "library", () => true);

  return plan.map((item, index) => {
    if (item.sourceKind !== "native" || item.action === "skip") return item;
    const assigned = targets.get(index);
    const fallbackTemplate = assigned
      ? undefined
      : libraryParticipants.find((overlay) => sameEvent(item, overlay));
    const reusableTemplate = assigned?.overlay ?? fallbackTemplate;
    const target = assigned?.source === "current" ? assigned.overlay : undefined;
    const inCurrentList = Boolean(target);
    const alreadyCorrect = inCurrentList && target &&
      (["name", "title", "event"] as const).every((field) =>
        (target[field] ?? "") === (item.patch[field] ?? ""));
    const action: OverlaySyncPlanItem["action"] = inCurrentList
      ? "update"
      : reusableTemplate ? "clone" : "create";
    return {
      ...item,
      action,
      targetOverlayId: reusableTemplate?.id,
      targetOverlayName: reusableTemplate?.name || undefined,
      targetOverlayEvent: reusableTemplate?.event || undefined,
      targetOverlaySource: assigned?.source === "library" || fallbackTemplate
        ? "library"
        : undefined,
      placementOnly: Boolean(alreadyCorrect),
      reason: alreadyCorrect ? "Existing overlay is already up to date." : undefined,
    };
  });
};

export type OverlayMatchResolution =
  | { kind: "match"; overlay: OverlayInfo; score: number }
  | { kind: "ambiguous"; score: number }
  | { kind: "none" };

/** Similarity between normalized planning element text and overlay.event. */
export const scoreOverlayEventMatch = (
  normalizedPlanningElement: string,
  overlayEvent: string | undefined,
): number => {
  const normalizedEvent = normalizeOverlayEvent(overlayEvent);
  if (!normalizedEvent) return 0;

  if (normalizedPlanningElement === normalizedEvent) return 100;
  if (normalizedPlanningElement.includes(normalizedEvent)) {
    return Math.max(
      30,
      (normalizedEvent.length / normalizedPlanningElement.length) * 80,
    );
  }
  if (normalizedEvent.includes(normalizedPlanningElement)) {
    return Math.max(
      30,
      (normalizedPlanningElement.length / normalizedEvent.length) * 80,
    );
  }

  const elementWords = normalizedPlanningElement.split(/\s+/);
  const overlayWords = normalizedEvent.split(/\s+/);
  const matchingWords = elementWords.filter(
    (word) =>
      word.length > 2 &&
      overlayWords.some((overlayWord) =>
        overlayWord.includes(word) || word.includes(overlayWord),
      ),
  );

  if (matchingWords.length === 0) return 0;
  return Math.max(
    25,
    (matchingWords.length / Math.max(elementWords.length, overlayWords.length)) *
      60,
  );
};

const resolveBestFuzzyOverlayMatch = (
  planningElementType: string,
  overlays: OverlayInfo[],
): OverlayMatchResolution => {
  const normalized = normalizeElementTypeForMatch(planningElementType);
  const scored = overlays
    .filter(isParticipantOverlay)
    .map((overlay) => ({
      overlay,
      score: scoreOverlayEventMatch(normalized, overlay.event),
    }))
    .filter(({ score }) => score >= MIN_SCORE);

  if (scored.length === 0) return { kind: "none" };

  const bestScore = Math.max(...scored.map(({ score }) => score));
  const bestMatches = scored.filter(({ score }) => score === bestScore);
  if (bestMatches.length !== 1) return { kind: "ambiguous", score: bestScore };

  return { kind: "match", ...bestMatches[0] };
};

export const findBestOverlayMatch = (
  planningElementType: string,
  overlays: OverlayInfo[],
): { overlay: OverlayInfo; score: number } | null => {
  const resolution = resolveBestFuzzyOverlayMatch(planningElementType, overlays);
  return resolution.kind === "match" ? resolution : null;
};

/**
 * Resolve one planned participant to a reusable overlay. Explicit configured
 * event labels use normalized exact matches; repeated labels claim rows in list
 * order through `excludeIds`. Fuzzy fallback is used only when no event label
 * is configured, and equal best matches are left unresolved.
 */
export const findOverlayForServicePlanningCandidate = (
  planningElementType: string,
  targetEvent: string | undefined,
  list: OverlayInfo[],
  excludeIds?: ReadonlySet<string>,
  options?: { duplicateExactMatchesAreAmbiguous?: boolean },
): OverlayMatchResolution => {
  const pool = list.filter(
    (overlay) =>
      !excludeIds?.has(overlay.id) && isParticipantOverlay(overlay),
  );
  if (pool.length === 0) return { kind: "none" };

  const normalizedTargetEvent = normalizeOverlayEvent(targetEvent);
  if (normalizedTargetEvent) {
    const exactMatches = pool.filter(
      (overlay) => normalizeOverlayEvent(overlay.event) === normalizedTargetEvent,
    );
    if (
      options?.duplicateExactMatchesAreAmbiguous &&
      exactMatches.length > 1
    ) {
      return { kind: "ambiguous", score: 100 };
    }
    return exactMatches[0]
      ? { kind: "match", overlay: exactMatches[0], score: 100 }
      : { kind: "none" };
  }

  return resolveBestFuzzyOverlayMatch(planningElementType, pool);
};
