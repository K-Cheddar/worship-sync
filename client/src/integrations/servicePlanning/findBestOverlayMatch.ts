import type { OverlayInfo } from "../../types";
import { normalizeElementTypeForMatch } from "./normalizeElementForMatch";
import type { ServicePlanOverlaySource } from "./servicePlanningOverlayClone";

const MIN_SCORE = 25;
const isParticipantOverlay = (overlay: OverlayInfo): boolean =>
  (overlay.type ?? "participant") === "participant";

/** Similarity between normalized planning element text and overlay.event (ported from Overlays getNames). */
export const scoreOverlayEventMatch = (
  normalizedPlanningElement: string,
  overlayEvent: string | undefined,
): number => {
  const overlayEventLower = overlayEvent?.toLowerCase().replace(/\s+/g, " ").trim() || "";
  if (!overlayEventLower) return 0;

  const cleanElement = normalizedPlanningElement;

  if (cleanElement === overlayEventLower) return 100;
  if (cleanElement.includes(overlayEventLower)) {
    return Math.max(30, (overlayEventLower.length / cleanElement.length) * 80);
  }
  if (overlayEventLower.includes(cleanElement)) {
    return Math.max(30, (cleanElement.length / overlayEventLower.length) * 80);
  }

  const elementWords = cleanElement.split(/\s+/);
  const overlayWords = overlayEventLower.split(/\s+/);
  const matchingWords = elementWords.filter(
    (word) =>
      word.length > 2 &&
      overlayWords.some((ow) => ow.includes(word) || word.includes(ow)),
  );

  if (matchingWords.length > 0) {
    return Math.max(
      25,
      (matchingWords.length /
        Math.max(elementWords.length, overlayWords.length)) *
        60,
    );
  }

  return 0;
};

export const findBestOverlayMatch = (
  planningElementType: string,
  overlays: OverlayInfo[],
): { overlay: OverlayInfo; score: number } | null => {
  const normalized = normalizeElementTypeForMatch(planningElementType);
  const participantOverlays = overlays.filter(isParticipantOverlay);
  let best: OverlayInfo | null = null;
  let bestScore = 0;

  for (const overlay of participantOverlays) {
    const score = scoreOverlayEventMatch(normalized, overlay.event);
    if (score > bestScore && score >= MIN_SCORE) {
      bestScore = score;
      best = overlay;
    }
  }

  return best ? { overlay: best, score: bestScore } : null;
};

/**
 * Prefer exact `overlay.event` matches for planned target events (split roles).
 * When Service Planning has an explicit event slot, fuzzy fallback can mutate
 * the wrong weekly overlay, so missing exact slots should clone/create instead.
 * `excludeIds`: overlays already assigned earlier in the same sync run so duplicate role strings (e.g. two Co-Host slots)
 * map to separate overlays instead of overwriting the same row.
 */
export const findOverlayForServicePlanningCandidate = (
  planningElementType: string,
  targetEvent: string | undefined,
  list: OverlayInfo[],
  excludeIds?: ReadonlySet<string>,
  source?: ServicePlanOverlaySource,
): OverlayInfo | null => {
  let pool =
    excludeIds?.size && excludeIds.size > 0
      ? list.filter((o) => !excludeIds.has(o.id) && isParticipantOverlay(o))
      : list.filter(isParticipantOverlay);
  if (pool.length === 0) return null;

  if (source) {
    const associated = pool.find((overlay) =>
      overlay.servicePlanSource?.planKey === source.planKey
      && overlay.servicePlanSource.elementId === source.elementId
      && overlay.servicePlanSource.candidateId === source.candidateId,
    );
    if (associated) return associated;
    // A saved overlay already owned by another service occurrence cannot be
    // silently reassigned through a title match.
    pool = pool.filter((overlay) => !overlay.servicePlanSource);
  }

  if (targetEvent?.trim()) {
    const te = targetEvent.toLowerCase().replace(/\s+/g, " ").trim();
    const exactMatches = pool.filter(
        (o) =>
          (o.event || "").toLowerCase().replace(/\s+/g, " ").trim() === te,
      );
    return exactMatches.length === 1 ? exactMatches[0] : null;
  }

  return findBestOverlayMatch(planningElementType, pool)?.overlay ?? null;
};
