import { formatPlainDateRangeLabel } from "./Teams/teamsUtils";
import type { VolunteerAvailabilityRequest } from "./myScheduleOperations";

export type AvailabilityChoice = "available" | "unavailable" | "not-answered";
export type AvailabilityOrganizeMode = "byDate" | "byService";

export type AvailabilityOccurrence = VolunteerAvailabilityRequest["occurrences"][number];

export type AvailabilityOccurrenceGroup = {
  key: string;
  label: string;
  occurrences: AvailabilityOccurrence[];
};

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

const occurrenceTime = (occurrence: AvailabilityOccurrence) => {
  const timestamp = Date.parse(occurrence.startsAt);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
};

const compareOccurrences = (first: AvailabilityOccurrence, second: AvailabilityOccurrence) =>
  occurrenceTime(first) - occurrenceTime(second) || first.occurrenceId.localeCompare(second.occurrenceId);

const availabilityOccurrenceIdentity = (occurrenceId: string) => {
  const separator = occurrenceId.lastIndexOf("@");
  if (separator <= 0) return "";
  const suffix = occurrenceId.slice(separator + 1);
  if (!/^\d{4}-\d{2}-\d{2}(?:T[^@]+)?$/.test(suffix) || !Number.isFinite(Date.parse(suffix))) return "";
  return occurrenceId.slice(0, separator);
};

/** Group copied occurrence rows without changing the saved request snapshot. */
export const organizeAvailabilityOccurrences = ({
  occurrences,
  mode,
  serviceTimeZone,
}: {
  occurrences: AvailabilityOccurrence[];
  mode: AvailabilityOrganizeMode;
  serviceTimeZone: string | null | undefined;
}): AvailabilityOccurrenceGroup[] => {
  const groups = new Map<string, AvailabilityOccurrence[]>();

  occurrences.forEach((occurrence) => {
    if (mode === "byDate") {
      const date = serviceDateForSummary(occurrence, serviceTimeZone);
      const key = date || `date-unavailable:${occurrence.occurrenceId}`;
      groups.set(key, [...(groups.get(key) || []), occurrence]);
      return;
    }

    // Current IDs use either group:<groupId>@<service date> or
    // <serviceId>@<service date>. Legacy/unparseable IDs remain separate.
    const identity = availabilityOccurrenceIdentity(occurrence.occurrenceId);
    const key = identity || `occurrence:${occurrence.occurrenceId}`;
    groups.set(key, [...(groups.get(key) || []), occurrence]);
  });

  const result = [...groups.entries()].map(([key, rows]) => {
    const sortedRows = [...rows].sort(compareOccurrences);
    const first = sortedRows[0];
    const serviceDate = serviceDateForSummary(first, serviceTimeZone);
    return {
      key,
      label: mode === "byDate"
        ? serviceDate ? formatPlainDateRangeLabel(serviceDate, serviceDate) : "Date unavailable"
        : String(first?.name || "Service").trim() || "Service",
      occurrences: sortedRows,
    };
  });

  return result.sort((first, second) => {
    if (mode === "byDate") {
      const firstDate = first.key.startsWith("date-unavailable:") ? "9999-99-99" : first.key;
      const secondDate = second.key.startsWith("date-unavailable:") ? "9999-99-99" : second.key;
      return firstDate.localeCompare(secondDate) || first.key.localeCompare(second.key);
    }
    const firstTime = occurrenceTime(first.occurrences[0]);
    const secondTime = occurrenceTime(second.occurrences[0]);
    return firstTime - secondTime || first.label.localeCompare(second.label) || first.key.localeCompare(second.key);
  });
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
  preserveUnansweredOccurrenceIds: Iterable<string> = [],
): VolunteerAvailabilityRequest["availability"] => {
  const preserveUnanswered = new Set(preserveUnansweredOccurrenceIds);
  return Object.fromEntries(occurrenceIds.flatMap((id) => {
    const answer = availability[id];
    if (answer === "available" || answer === "unavailable") return [[id, answer]];
    return preserveUnanswered.has(id) ? [] : [[id, "unavailable"]];
  }));
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

/** Date-grouped cards already show the date in their section heading. */
export const formatAvailabilityOccurrenceTime = (
  occurrence: AvailabilityOccurrence,
  serviceTimeZone: string | null | undefined,
) => {
  if (!serviceTimeZone || !Number.isFinite(Date.parse(occurrence.startsAt))) return "";
  return new Date(occurrence.startsAt).toLocaleTimeString(undefined, {
    timeZone: serviceTimeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
};

export const isAvailabilityOccurrencePast = (
  occurrence: AvailabilityOccurrence,
  now = Date.now(),
) => {
  const startsAt = Date.parse(occurrence.startsAt);
  return Number.isFinite(startsAt) && startsAt < now;
};

export const formatAvailabilityDeadline = (deadline: string) =>
  deadline ? formatPlainDateRangeLabel(deadline, deadline) : "";
