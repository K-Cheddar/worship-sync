import type { Box } from "../types";
import type { ElectronMediaCandidateSourceKind } from "./electronMediaSurfaceDiagnostics";

export type ElectronMediaSurfacePerformanceClass =
  | "constrained"
  | "normal"
  | "high-performance";

/** Protected current/transition media can exceed these soft budgets. */
export const ELECTRON_MEDIA_SURFACE_POLICY = {
  constrained: 8,
  normal: 14,
  "high-performance": 24,
} as const satisfies Record<ElectronMediaSurfacePerformanceClass, number>;

export type ElectronMediaSurfaceBudget = {
  performanceClass: ElectronMediaSurfacePerformanceClass;
  budget: number;
};

/** A caller-supplied override is the integration point for a future governor. */
export const resolveElectronMediaSurfaceBudget = (
  performanceClass: ElectronMediaSurfacePerformanceClass = "normal",
  budgetOverride?: number,
): ElectronMediaSurfaceBudget => ({
  performanceClass,
  budget:
    budgetOverride != null && Number.isFinite(budgetOverride)
    ? Math.max(0, Math.floor(budgetOverride))
    : ELECTRON_MEDIA_SURFACE_POLICY[performanceClass],
});

export const DEFAULT_ELECTRON_MEDIA_SURFACE_BUDGET =
  ELECTRON_MEDIA_SURFACE_POLICY.normal;

export type ElectronMediaSurfaceCandidate = {
  mediaKey: string;
  source: string;
  itemId?: string;
  itemIndex?: number;
  priority?: number;
  protected?: boolean;
  originalSource?: string;
  sourceKind?: ElectronMediaCandidateSourceKind;
  reason?: string;
  itemName?: string;
};

export type ElectronMediaSurfaceView = {
  mediaKey: string;
  source: string;
  videoBox: Box;
  /** Omit while GSAP owns the surface opacity during a transition. */
  opacity?: number;
  zIndex: number;
  shouldPlay: boolean;
  muted: boolean;
  volume: number;
  playback?: {
    mediaKey: string;
    positionSeconds: number;
    paused: boolean;
    atServerMs: number;
    generation: number;
    applySeek: boolean;
  };
  /** Only an active selected editor surface may publish editor transport. */
  reportsEditorTransport?: boolean;
};

const finiteItemIndex = (value: number | undefined): number =>
  Number.isFinite(value) ? (value as number) : Number.MAX_SAFE_INTEGER;

const candidatePriority = (
  candidate: ElectronMediaSurfaceCandidate,
  currentMediaKey: string | undefined,
  currentItemId: string | undefined,
  currentItemIndex: number | undefined,
): [number, number, number] => {
  if (candidate.mediaKey === currentMediaKey) return [0, 0, 0];
  if (candidate.itemId && candidate.itemId === currentItemId) {
    return [1, 0, finiteItemIndex(candidate.itemIndex)];
  }
  if (currentItemIndex != null && candidate.itemIndex != null) {
    return [
      2,
      Math.abs(candidate.itemIndex - currentItemIndex),
      candidate.itemIndex,
    ];
  }
  return [3, 0, finiteItemIndex(candidate.itemIndex)];
};

/**
 * Selects one deterministic identity-keyed preparation set. The first
 * occurrence of a media identity wins, except that protected identities are
 * always retained even when the normal budget is full.
 */
export const selectElectronMediaSurfaceCandidates = ({
  candidates,
  currentMediaKey,
  currentItemId,
  protectedMediaKeys = [],
  maxSurfaces,
  performanceClass = "normal",
}: {
  candidates: ElectronMediaSurfaceCandidate[];
  currentMediaKey?: string;
  currentItemId?: string;
  protectedMediaKeys?: string[];
  /** Legacy name retained for callers; treated as a soft budget override. */
  maxSurfaces?: number;
  performanceClass?: ElectronMediaSurfacePerformanceClass;
}): ElectronMediaSurfaceCandidate[] => {
  const unique = new Map<string, ElectronMediaSurfaceCandidate>();
  candidates.forEach((candidate) => {
    if (!candidate.mediaKey || !candidate.source || unique.has(candidate.mediaKey)) {
      return;
    }
    unique.set(candidate.mediaKey, candidate);
  });

  const protectedSet = new Set(protectedMediaKeys.filter(Boolean));
  if (currentMediaKey) protectedSet.add(currentMediaKey);
  const currentItemIndex = candidates.find(
    (candidate) => candidate.itemId === currentItemId,
  )?.itemIndex;
  const prioritized = [...unique.values()].sort((left, right) => {
    const leftPriority = candidatePriority(
      left,
      currentMediaKey,
      currentItemId,
      currentItemIndex,
    );
    const rightPriority = candidatePriority(
      right,
      currentMediaKey,
      currentItemId,
      currentItemIndex,
    );
    for (let index = 0; index < leftPriority.length; index += 1) {
      if (leftPriority[index] !== rightPriority[index]) {
        return leftPriority[index] - rightPriority[index];
      }
    }
    return left.mediaKey.localeCompare(right.mediaKey);
  });

  const { budget } = resolveElectronMediaSurfaceBudget(
    performanceClass,
    maxSurfaces,
  );
  const selected = prioritized.slice(0, budget);
  const selectedKeys = new Set(selected.map((candidate) => candidate.mediaKey));
  prioritized.forEach((candidate) => {
    if (protectedSet.has(candidate.mediaKey) && !selectedKeys.has(candidate.mediaKey)) {
      selected.push(candidate);
      selectedKeys.add(candidate.mediaKey);
    }
  });

  return selected.map((candidate, priority) => ({
    ...candidate,
    priority,
    protected: protectedSet.has(candidate.mediaKey),
  }));
};

export const getEvictedElectronMediaSurfaceKeys = (
  previousKeys: string[],
  nextCandidates: ElectronMediaSurfaceCandidate[],
  protectedMediaKeys: string[] = [],
): string[] => {
  const nextKeys = new Set(nextCandidates.map((candidate) => candidate.mediaKey));
  const protectedSet = new Set(protectedMediaKeys);
  return previousKeys.filter(
    (mediaKey) => !nextKeys.has(mediaKey) && !protectedSet.has(mediaKey),
  );
};
