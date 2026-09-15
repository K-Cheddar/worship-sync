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
