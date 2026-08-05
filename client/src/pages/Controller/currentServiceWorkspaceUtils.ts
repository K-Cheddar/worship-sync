import type { TeamScheduleOccurrence, TeamService } from "../../api/authTypes";
import type { Presentation } from "../../types";
import { generateScheduleOccurrences } from "../../utils/teamScheduleOccurrences";

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

/**
 * How long a service is presumed to be running once it starts. The schedule
 * records a start time and nothing else, and services regularly run past their
 * plan, so this is deliberately generous — it only decides when a service stops
 * being treated as "in progress", never when it stops being selectable.
 */
const SERVICE_RUN_WINDOW_MS = 3 * 60 * 60_000;
/** Keep finished services pickable for a couple of days: a plan is often
 * revisited after the service, and the handover below needs the previous
 * service to still be in the list to compare against. */
const CURRENT_SERVICE_LOOKBACK_DAYS = 2;
const CURRENT_SERVICE_LOOKAHEAD_DAYS = 7;
const DAY_MS = 24 * 60 * 60_000;

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

/** Every occurrence in the current window, earliest first — the set an operator
 * can pick from when the auto-selected service isn't the one they're prepping. */
export const listCurrentServiceOccurrences = (
  services: TeamService[],
  nowMs = Date.now(),
): TeamScheduleOccurrence[] => {
  if (services.length === 0) return [];
  const startDate = new Date(nowMs - CURRENT_SERVICE_LOOKBACK_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const endDate = new Date(nowMs + CURRENT_SERVICE_LOOKAHEAD_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return generateScheduleOccurrences({
    services,
    serviceIds: services.map((service) => service.serviceId),
    startDate,
    endDate,
  })
    .filter((occurrence) => Number.isFinite(Date.parse(occurrence.startsAt)))
    .sort(
      (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt),
    );
};

/**
 * Picks the service an operator is most likely working on right now: the one
 * that started most recently, until the next one is closer in time.
 *
 * Deliberately *not* "switch as soon as the scheduled window ends". A service
 * that runs long would otherwise flip the Controller onto next week's plan
 * mid-service. Instead the running service holds the slot until it is presumed
 * finished, and the handover to the next service happens halfway through the
 * gap between them — so a 1pm finish with a 2pm service next hands over at
 * 1:30pm, while a 1pm finish with nothing until Wednesday keeps today's plan
 * for the rest of the day.
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
    const startsAtMs = Date.parse(occurrence.startsAt);
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

  // The running service keeps the slot until it is presumed finished, and never
  // past the moment the next service starts.
  const previousEndsAtMs = Math.min(
    previousStartsAtMs + SERVICE_RUN_WINDOW_MS,
    nextStartsAtMs,
  );
  const handoverMs = previousEndsAtMs + (nextStartsAtMs - previousEndsAtMs) / 2;
  return nowMs >= handoverMs ? next : previous;
};

/** Convenience wrapper for callers that only have the services list. */
export const findCurrentServiceOccurrence = (
  services: TeamService[],
  nowMs = Date.now(),
): TeamScheduleOccurrence | null =>
  pickCurrentServiceOccurrence(
    listCurrentServiceOccurrences(services, nowMs),
    nowMs,
  );
