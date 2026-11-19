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
  if (!hasAvailabilityResponseSubmission(request)) return "Not yet submitted";
  const counts = getAvailabilityCounts(request);
  return counts.unanswered > 0
    ? `Response submitted · ${counts.unanswered} unanswered`
    : "Response submitted";
};

export const hasAvailabilityResponseSubmission = (
  request: Pick<VolunteerAvailabilityRequest, "respondedAt" | "submissionId">,
) => Boolean(request.respondedAt || request.submissionId);

export type AvailabilityRequestGroup = "needs-response" | "submitted-responses" | "closed";

export const getAvailabilityRequestGroup = (
  request: VolunteerAvailabilityRequest,
): AvailabilityRequestGroup => {
  if (!request.editable) return "closed";
  return hasAvailabilityResponseSubmission(request)
    ? "submitted-responses"
    : "needs-response";
};

const serviceDateForSummary = (
  occurrence: VolunteerAvailabilityRequest["occurrences"][number],
  serviceTimeZone: string | null | undefined,
) => {
  const occurrenceIdDate = occurrence.occurrenceId.match(/@((?:\d{4}-\d{2}-\d{2}))$/)?.[1];
  if (occurrence.serviceDate || occurrenceIdDate) return occurrence.serviceDate || occurrenceIdDate || "";
  if (!serviceTimeZone || !Number.isFinite(Date.parse(occurrence.startsAt))) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: serviceTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(occurrence.startsAt));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const formatAvailabilityRequestDateRange = (
  request: VolunteerAvailabilityRequest,
  serviceTimeZone: string | null | undefined,
) => {
  const dates = request.occurrences
    .map((occurrence) => serviceDateForSummary(occurrence, serviceTimeZone))
    .filter(Boolean)
    .sort();
  if (!dates.length) return "";
  return formatPlainDateRangeLabel(dates[0], dates[dates.length - 1]);
};

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

/** Materialize checkbox intent only when the volunteer finalizes a response. */
export const createAvailabilityCheckboxSubmission = (
  occurrenceIds: string[],
  availability: VolunteerAvailabilityRequest["availability"],
): VolunteerAvailabilityRequest["availability"] => Object.fromEntries(
  occurrenceIds.map((id) => [id, availability[id] === "available" ? "available" : "unavailable"]),
);

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
