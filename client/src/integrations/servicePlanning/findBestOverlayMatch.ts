import type { OverlayInfo } from "../../types";
import { normalizeElementTypeForMatch } from "./normalizeElementForMatch";

const MIN_SCORE = 25;
const isParticipantOverlay = (overlay: OverlayInfo): boolean =>
  (overlay.type ?? "participant") === "participant";

export const normalizeOverlayEvent = (event?: string): string =>
  (event || "").toLowerCase().replace(/\s+/g, " ").trim();

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
