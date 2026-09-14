import type { TeamScheduleOccurrence, TeamService } from "../api/authTypes";
import type { ServiceTime } from "../types";
import { generateScheduleOccurrences } from "./teamScheduleOccurrences";
import { serverDate } from "./serverTime";

export const CURRENT_SERVICE_RUN_WINDOW_MS = 3 * 60 * 60 * 1000;
export const CURRENT_SERVICE_LOOKBACK_DAYS = 2;
export const CURRENT_SERVICE_LOOKAHEAD_DAYS = 7;
export const CURRENT_SERVICE_RECENT_GRACE_MS = 90 * 60 * 1000;

export type CurrentServiceOccurrenceWindow = {
  lookbackDays?: number;
  lookaheadDays?: number;
};

export type CurrentServiceResolutionReason =
  | "in-progress"
  | "upcoming-today"
  | "recently-ended"
  | "upcoming"
  | "none";

export interface CurrentServiceResolution {
  occurrence: TeamScheduleOccurrence | null;
  reason: CurrentServiceResolutionReason;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const occurrenceTime = (occurrence: TeamScheduleOccurrence): number =>
  Date.parse(occurrence.startsAt);

const compareOccurrences = (
  left: TeamScheduleOccurrence,
  right: TeamScheduleOccurrence,
): number => {
  const timeDifference = occurrenceTime(left) - occurrenceTime(right);
  return timeDifference || left.occurrenceId.localeCompare(right.occurrenceId);
};

const localDayKey = (timestampMs: number): string => {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const sortedFiniteOccurrences = (
  occurrences: TeamScheduleOccurrence[],
): TeamScheduleOccurrence[] =>
  occurrences
    .filter((occurrence) => Number.isFinite(occurrenceTime(occurrence)))
    .slice()
    .sort(compareOccurrences);

const toTeamService = (service: ServiceTime): TeamService => ({
  ...service,
  serviceId: (
    service as ServiceTime & Partial<Pick<TeamService, "serviceId">>
  ).serviceId || service.id,
  churchId: (
    service as ServiceTime & Partial<Pick<TeamService, "churchId">>
  ).churchId || "",
});

export const listCurrentServiceOccurrences = (
  services: ServiceTime[],
  nowMs = Date.now(),
  window: CurrentServiceOccurrenceWindow = {},
): TeamScheduleOccurrence[] => {
  const activeServices = services
    .filter((service) => !service.archivedAt)
    .map(toTeamService);
  if (activeServices.length === 0) return [];
  const lookbackDays = Math.max(
    0,
    window.lookbackDays ?? CURRENT_SERVICE_LOOKBACK_DAYS,
  );
  const lookaheadDays = Math.max(
    0,
    window.lookaheadDays ?? CURRENT_SERVICE_LOOKAHEAD_DAYS,
  );
  const startDate = new Date(nowMs - lookbackDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const endDate = new Date(nowMs + lookaheadDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return generateScheduleOccurrences({
    services: activeServices,
    serviceIds: activeServices.map((service) => service.serviceId),
    startDate,
    endDate,
  })
    .filter((occurrence) => Number.isFinite(occurrenceTime(occurrence)))
    .sort((left, right) => occurrenceTime(left) - occurrenceTime(right));
};

/**
 * Preserves the existing controller workspace handoff behavior. The viewer
 * uses resolveCurrentServiceOccurrence below because it has a different UX
 * contract for upcoming and recently ended services.
 */
export const pickCurrentServiceOccurrence = (
  occurrences: TeamScheduleOccurrence[],
  nowMs = Date.now(),
): TeamScheduleOccurrence | null => {
  let previous: TeamScheduleOccurrence | null = null;
  let previousStartsAtMs = -Infinity;
  let next: TeamScheduleOccurrence | null = null;
  let nextStartsAtMs = Infinity;

  for (const occurrence of occurrences) {
    const startsAtMs = occurrenceTime(occurrence);
    if (!Number.isFinite(startsAtMs)) continue;
    if (startsAtMs <= nowMs) {
      if (startsAtMs >= previousStartsAtMs) {
        previous = occurrence;
        previousStartsAtMs = startsAtMs;
      }
    } else if (startsAtMs < nextStartsAtMs) {
      next = occurrence;
      nextStartsAtMs = startsAtMs;
    }
  }

  if (!previous) return next;
  if (!next) return previous;

  const previousEndsAt = Math.min(
    previousStartsAtMs + CURRENT_SERVICE_RUN_WINDOW_MS,
    nextStartsAtMs,
  );
  const handoverAt =
    previousEndsAt + (nextStartsAtMs - previousEndsAt) / 2;

  return nowMs < handoverAt ? previous : next;
};

export const resolveCurrentServiceOccurrence = (
  occurrences: TeamScheduleOccurrence[],
  nowMs = serverDate().getTime(),
): CurrentServiceResolution => {
  const sortedOccurrences = sortedFiniteOccurrences(occurrences);
  const todayKey = localDayKey(nowMs);

  const inProgress = sortedOccurrences
    .filter((occurrence) => {
      const startsAt = occurrenceTime(occurrence);
      return (
        startsAt <= nowMs &&
        nowMs < startsAt + CURRENT_SERVICE_RUN_WINDOW_MS
      );
    })
    .at(-1);
  if (inProgress) {
    return { occurrence: inProgress, reason: "in-progress" };
  }

  const upcomingToday = sortedOccurrences.find(
    (occurrence) =>
      occurrenceTime(occurrence) > nowMs &&
      localDayKey(occurrenceTime(occurrence)) === todayKey,
  );
  if (upcomingToday) {
    return { occurrence: upcomingToday, reason: "upcoming-today" };
  }

  const recentlyEnded = sortedOccurrences
    .filter((occurrence) => {
      const endsAt = occurrenceTime(occurrence) + CURRENT_SERVICE_RUN_WINDOW_MS;
      return (
        localDayKey(occurrenceTime(occurrence)) === todayKey &&
        nowMs >= endsAt &&
        nowMs <= endsAt + CURRENT_SERVICE_RECENT_GRACE_MS
      );
    })
    .at(-1);
  if (recentlyEnded) {
    return { occurrence: recentlyEnded, reason: "recently-ended" };
  }

  const upcoming = sortedOccurrences.find(
    (occurrence) => occurrenceTime(occurrence) > nowMs,
  );
  return upcoming
    ? { occurrence: upcoming, reason: "upcoming" }
    : { occurrence: null, reason: "none" };
};

export const findCurrentServiceOccurrence = (
  services: ServiceTime[],
  nowMs = Date.now(),
): TeamScheduleOccurrence | null =>
  pickCurrentServiceOccurrence(
    listCurrentServiceOccurrences(services, nowMs),
    nowMs,
  );

export const getCurrentServiceResolutionRecheckAtMs = (
  occurrences: TeamScheduleOccurrence[],
  nowMs = serverDate().getTime(),
): number | null => {
  const resolution = resolveCurrentServiceOccurrence(occurrences, nowMs);
  const futureStarts = sortedFiniteOccurrences(occurrences)
    .map(occurrenceTime)
    .filter((startsAt) => startsAt > nowMs);
  const nextStart = futureStarts[0];

  if (!resolution.occurrence) return nextStart ?? null;

  const occurrenceEnd =
    occurrenceTime(resolution.occurrence) +
    CURRENT_SERVICE_RUN_WINDOW_MS +
    CURRENT_SERVICE_RECENT_GRACE_MS;
  return Math.min(
    occurrenceEnd,
    nextStart ?? Number.POSITIVE_INFINITY,
  );
};
