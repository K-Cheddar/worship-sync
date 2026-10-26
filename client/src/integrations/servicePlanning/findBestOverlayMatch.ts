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
  const pool = [...current, ...library.filter((overlay) => !currentIds.has(overlay.id))]
    .filter(isParticipantOverlay);
  const claimed = new Set<string>();
  const targets = new Map<OverlaySyncPlanItem, OverlayInfo>();
  const candidates = plan.filter((item) => item.sourceKind === "native" && item.action !== "skip");
  const sameEvent = (item: OverlaySyncPlanItem, overlay: OverlayInfo) =>
    Boolean(normalizeOverlayEvent(item.patch.event)) &&
    normalizeOverlayEvent(item.patch.event) === normalizeOverlayEvent(overlay.event);

  for (const pass of ["identity", "song", "slot"] as const) {
    for (const item of candidates) {
      if (targets.has(item)) continue;
      const target = pool.find((overlay) => {
        if (claimed.has(overlay.id) || !sameEvent(item, overlay)) return false;
        const sameName = normalizeOverlayEvent(item.patch.name) === normalizeOverlayEvent(overlay.name);
        const sameTitle = normalizeOverlayEvent(item.patch.title) === normalizeOverlayEvent(overlay.title);
        if (pass === "identity") return sameName && (!item.isSong || sameTitle);
        if (pass === "song") return item.isSong === true && sameTitle;
        return true;
      });
      if (target) {
        targets.set(item, target);
        claimed.add(target.id);
      }
    }
  }

  return plan.map((item) => {
    if (item.sourceKind !== "native" || item.action === "skip") return item;
    const target = targets.get(item);
    const template = target ?? pool.find((overlay) => sameEvent(item, overlay));
    const inCurrentList = Boolean(target && currentIds.has(target.id));
    const alreadyCorrect = inCurrentList && target &&
      (["name", "title", "event"] as const).every((field) =>
        (target[field] ?? "") === (item.patch[field] ?? ""));
    let action: OverlaySyncPlanItem["action"] = "create";
    if (inCurrentList) action = "update";
    else if (template) action = "clone";
    return {
      ...item,
      action,
      targetOverlayId: template?.id,
      targetOverlayName: template?.name || undefined,
      targetOverlayEvent: template?.event || undefined,
      targetOverlaySource: template && !currentIds.has(template.id) ? "library" : undefined,
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
