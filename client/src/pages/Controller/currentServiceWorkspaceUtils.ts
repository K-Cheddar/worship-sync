import type { TeamScheduleOccurrence, TeamService } from "../../api/authTypes";
import { generateScheduleOccurrences } from "../../utils/teamScheduleOccurrences";

const CURRENT_SERVICE_WINDOW_MS = 3 * 60 * 60_000;
const CURRENT_SERVICE_LOOKAHEAD_DAYS = 7;

/** Every occurrence in the current window, earliest first — the set an operator
 * can pick from when the auto-selected service isn't the one they're prepping. */
export const listCurrentServiceOccurrences = (
  services: TeamService[],
  nowMs = Date.now(),
): TeamScheduleOccurrence[] => {
  if (services.length === 0) return [];
  const startDate = new Date(nowMs - CURRENT_SERVICE_WINDOW_MS)
    .toISOString()
    .slice(0, 10);
  const endDate = new Date(nowMs + CURRENT_SERVICE_LOOKAHEAD_DAYS * 24 * 60 * 60_000)
    .toISOString()
    .slice(0, 10);
  return generateScheduleOccurrences({
    services,
    serviceIds: services.map((service) => service.serviceId),
    startDate,
    endDate,
  })
    .filter((occurrence) => Number.isFinite(Date.parse(occurrence.startsAt)))
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
};

/** Selects the service in progress, otherwise the next scheduled service. This
 * mirrors the public current-service behavior without requiring publication. */
export const findCurrentServiceOccurrence = (
  services: TeamService[],
  nowMs = Date.now(),
): TeamScheduleOccurrence | null => {
  const occurrences = listCurrentServiceOccurrences(services, nowMs);
  if (occurrences.length === 0) return null;

  const active = occurrences
    .filter((occurrence) => {
      const startsAtMs = Date.parse(occurrence.startsAt);
      return startsAtMs <= nowMs && nowMs < startsAtMs + CURRENT_SERVICE_WINDOW_MS;
    })
    .sort((left, right) => Date.parse(right.startsAt) - Date.parse(left.startsAt))[0];
  if (active) return active;

  return (
    occurrences.find((occurrence) => Date.parse(occurrence.startsAt) > nowMs) ||
    null
  );
};
