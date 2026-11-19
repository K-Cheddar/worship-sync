import { formatPlainDateRangeLabel } from "./Teams/teamsUtils";
import type { VolunteerAvailabilityRequest } from "./myScheduleOperations";

export type AvailabilityChoice = "available" | "unavailable" | "not-answered";

export const getAvailabilityCounts = (request: VolunteerAvailabilityRequest) => {
  const occurrenceIds = request.occurrences.map(({ occurrenceId }) => occurrenceId);
  const answered = occurrenceIds.filter((id) => request.availability[id]);
  return {
    available: answered.filter((id) => request.availability[id] === "available").length,
    unavailable: answered.filter((id) => request.availability[id] === "unavailable").length,
    unanswered: occurrenceIds.filter((id) => request.unansweredOccurrenceIds.includes(id)).length,
    total: occurrenceIds.length,
  };
};

export const getAvailabilityRequestStatus = (
  request: VolunteerAvailabilityRequest,
) => {
  if (!request.editable) return "Closed";
  const counts = getAvailabilityCounts(request);
  if (counts.unanswered > 0 && counts.available + counts.unavailable > 0) {
    return "Partially answered";
  }
  if (counts.unanswered > 0) return "Not answered";
  return "Answered";
};

export const getAvailabilityRequestGroup = (
  request: VolunteerAvailabilityRequest,
) =>
  request.editable && request.unansweredOccurrenceIds.length > 0
    ? "needs-response"
    : "previous-responses";

export const getAvailabilityChoice = (
  availability: VolunteerAvailabilityRequest["availability"],
  occurrenceId: string,
): AvailabilityChoice => availability[occurrenceId] || "not-answered";

export const setAvailabilityChoice = (
  availability: VolunteerAvailabilityRequest["availability"],
  occurrenceId: string,
  choice: AvailabilityChoice,
): VolunteerAvailabilityRequest["availability"] => {
  const next = { ...availability };
  if (choice === "not-answered") delete next[occurrenceId];
  else next[occurrenceId] = choice;
  return next;
};

export const formatAvailabilityOccurrence = (
  occurrence: VolunteerAvailabilityRequest["occurrences"][number],
  serviceTimeZone: string | null | undefined,
) => {
  const occurrenceIdDate = occurrence.occurrenceId.match(/@((?:\d{4}-\d{2}-\d{2}))$/)?.[1] || "";
  const date = occurrence.serviceDate || occurrenceIdDate;
  const dateLabel = date
    ? formatPlainDateRangeLabel(date, date)
    : serviceTimeZone && Number.isFinite(Date.parse(occurrence.startsAt))
      ? new Date(occurrence.startsAt).toLocaleDateString(undefined, {
          timeZone: serviceTimeZone,
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "Date unavailable";
  if (!serviceTimeZone || !Number.isFinite(Date.parse(occurrence.startsAt))) {
    return dateLabel;
  }
  const timeLabel = new Date(occurrence.startsAt).toLocaleTimeString(undefined, {
    timeZone: serviceTimeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${dateLabel} · ${timeLabel}`;
};

export const formatAvailabilityDeadline = (deadline: string) =>
  deadline ? formatPlainDateRangeLabel(deadline, deadline) : "";
