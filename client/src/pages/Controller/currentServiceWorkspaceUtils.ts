import type { TeamScheduleOccurrence, TeamService } from "../../api/authTypes";
import type { Presentation, ServiceTime } from "../../types";
import {
  findCurrentServiceOccurrence as findCurrentServiceOccurrenceFromResolution,
  listCurrentServiceOccurrences as listCurrentServiceOccurrencesFromResolution,
  pickCurrentServiceOccurrence as pickCurrentServiceOccurrenceFromResolution,
} from "../../utils/currentServiceResolution";

export type LiveSlideProgressSource = Pick<
  Presentation,
  "name" | "slide" | "slideIndex" | "slideCount"
>;

export type LiveSlideProgress = {
  name: string;
  /** 1-based position label, e.g. "3 of 12". */
  slideLabel: string;
};

export type LiveItemSource = Pick<Presentation, "name" | "itemId" | "listId">;

/** First active configured output wins, in registry order, for a stable list highlight. */
export const resolvePrimaryLiveOutput = <
  T extends { name?: string; itemId?: string; listId?: string },
>(
  outputs: T[],
): { output: T; index: number } | null => {
  const index = outputs.findIndex(
    (output) =>
      Boolean(output.name?.trim()) ||
      Boolean(output.itemId?.trim()) ||
      Boolean(output.listId?.trim()),
  );
  return index < 0 ? null : { output: outputs[index], index };
};

/**
 * Compact producer chrome for the live item.
 * Returns null when there is nothing useful to show (cleared / incomplete).
 */
export const formatLiveSlideProgress = (
  source: LiveSlideProgressSource | null | undefined,
): LiveSlideProgress | null => {
  const name = source?.name?.trim();
  if (!name) return null;
  const { slideIndex, slideCount } = source ?? {};
  if (
    typeof slideIndex !== "number" ||
    typeof slideCount !== "number" ||
    !Number.isFinite(slideIndex) ||
    !Number.isFinite(slideCount) ||
    slideCount < 1 ||
    slideIndex < 0 ||
    slideIndex >= slideCount
  ) {
    return null;
  }
  return {
    name,
    slideLabel: `${slideIndex + 1} of ${slideCount}`,
  };
};

/** Prefer projector as “what the room sees”; fall back to monitor. */
export const resolveLiveSlideProgress = (
  projectorInfo: LiveSlideProgressSource,
  monitorInfo: LiveSlideProgressSource,
): LiveSlideProgress | null =>
  formatLiveSlideProgress(projectorInfo) ??
  formatLiveSlideProgress(monitorInfo);

const hasLiveItemValue = (value: string | undefined): value is string =>
  Boolean(value?.trim());

const normalizeLiveItemName = (name: string): string =>
  name.trim().toLocaleLowerCase();

/**
 * Use the projector's current item as the room-facing source when present.
 * Historical projector payloads may lack outline IDs, so borrow monitor IDs
 * only when both presentations name the same item.
 */
export const resolveLiveItemSource = (
  projectorInfo: LiveItemSource,
  monitorInfo: LiveItemSource,
): LiveItemSource => {
  const projectorHasContent =
    hasLiveItemValue(projectorInfo.name) ||
    hasLiveItemValue(projectorInfo.itemId) ||
    hasLiveItemValue(projectorInfo.listId);
  if (!projectorHasContent) return monitorInfo;

  if (
    hasLiveItemValue(projectorInfo.listId) ||
    hasLiveItemValue(projectorInfo.itemId)
  ) {
    return projectorInfo;
  }

  const namesMatch =
    hasLiveItemValue(projectorInfo.name) &&
    hasLiveItemValue(monitorInfo.name) &&
    normalizeLiveItemName(projectorInfo.name) ===
      normalizeLiveItemName(monitorInfo.name);
  if (!namesMatch) return projectorInfo;

  return {
    ...projectorInfo,
    ...(hasLiveItemValue(monitorInfo.itemId)
      ? { itemId: monitorInfo.itemId }
      : {}),
    ...(hasLiveItemValue(monitorInfo.listId)
      ? { listId: monitorInfo.listId }
      : {}),
  };
};

/** Weekday + time is enough to tell nearby services apart in a picker. */
export const formatOccurrenceLabel = (startsAt: string): string => {
  const startsAtMs = Date.parse(startsAt);
  if (!Number.isFinite(startsAtMs)) return "";
  return new Date(startsAtMs).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

/** Existing controller workspace occurrence behavior, kept as a compatibility boundary. */
export const listCurrentServiceOccurrences = (
  services: TeamService[],
  nowMs?: number,
): TeamScheduleOccurrence[] =>
  listCurrentServiceOccurrencesFromResolution(services, nowMs);

export const pickCurrentServiceOccurrence = (
  occurrences: TeamScheduleOccurrence[],
  nowMs?: number,
): TeamScheduleOccurrence | null =>
  pickCurrentServiceOccurrenceFromResolution(occurrences, nowMs);

export const findCurrentServiceOccurrence = (
  services: TeamService[],
  nowMs?: number,
): TeamScheduleOccurrence | null =>
  findCurrentServiceOccurrenceFromResolution(services, nowMs);

/**
 * Services covered by the occurrence the operator has selected. Combined
 * occurrences carry every participating service ID; older plain occurrences
 * only carry their representative `serviceId`.
 */
export const getOccurrenceServices = (
  services: ServiceTime[],
  occurrence: TeamScheduleOccurrence | null,
): ServiceTime[] => {
  if (!occurrence) return [];
  const serviceIds = new Set(occurrence.serviceIds ?? [occurrence.serviceId]);
  return services.filter((service) => serviceIds.has(service.id));
};
