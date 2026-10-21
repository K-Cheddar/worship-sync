import type { MyScheduleOccurrence } from "../api/auth";
import type {
  MyScheduleAvailabilityOccurrence,
  VolunteerAvailabilityRequest,
} from "./myScheduleOperations";

export type TimelineAvailabilityRequest = Omit<
  VolunteerAvailabilityRequest,
  "occurrences" | "availability"
> & {
  occurrence: MyScheduleAvailabilityOccurrence;
  response?: "available" | "unavailable";
};

export type MyScheduleTimelineOccurrence = MyScheduleOccurrence & {
  availabilityRequests: TimelineAvailabilityRequest[];
};

export type MyScheduleMonthGroup = {
  key: string;
  label: string;
  occurrences: MyScheduleTimelineOccurrence[];
};

export type MyScheduleServiceGroup = {
  key: string;
  name: string;
  serviceIds: string[];
  occurrences: MyScheduleTimelineOccurrence[];
};

const isPlainDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const dateInTimeZone = (startsAt: string, timeZone: string): string => {
  const timestamp = Date.parse(startsAt);
  if (!Number.isFinite(timestamp)) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(timestamp);
    const getPart = (type: string) => parts.find((part) => part.type === type)?.value || "";
    const year = getPart("year");
    const month = getPart("month");
    const day = getPart("day");
    return year && month && day ? `${year}-${month}-${day}` : "";
  } catch {
    return "";
  }
};

export const myScheduleOccurrenceDate = (
  occurrence: Pick<MyScheduleOccurrence, "date" | "startsAt"> & {
    availabilityRequests?: TimelineAvailabilityRequest[];
  },
  timeZone: string,
): string => {
  if (isPlainDate(occurrence.date)) return occurrence.date;
  const formDate = occurrence.availabilityRequests?.find((request) =>
    isPlainDate(request.occurrence.serviceDate),
  )?.occurrence.serviceDate;
  return formDate || dateInTimeZone(occurrence.startsAt, timeZone);
};

export const buildMyScheduleTimeline = (
  assignedOccurrences: MyScheduleOccurrence[],
  requests: VolunteerAvailabilityRequest[],
  timeZone: string,
): MyScheduleTimelineOccurrence[] => {
  const byOccurrenceId = new Map<string, MyScheduleTimelineOccurrence>();

  assignedOccurrences.forEach((occurrence) => {
    byOccurrenceId.set(occurrence.occurrenceId, {
      ...occurrence,
      availabilityRequests: [],
    });
  });

  requests.forEach((request) => {
    request.occurrences.forEach((requestOccurrence) => {
      let occurrence = byOccurrenceId.get(requestOccurrence.occurrenceId);
      if (!occurrence) {
        occurrence = {
          occurrenceId: requestOccurrence.occurrenceId,
          name: requestOccurrence.name || "Service",
          serviceIds: [requestOccurrence.serviceId].filter(Boolean),
          date: requestOccurrence.serviceDate || dateInTimeZone(requestOccurrence.startsAt, timeZone),
          startsAt: requestOccurrence.startsAt,
          serving: [],
          plan: null,
          availabilityRequests: [],
        };
        byOccurrenceId.set(requestOccurrence.occurrenceId, occurrence);
      }
      occurrence.availabilityRequests.push({
        recipientId: request.recipientId,
        formId: request.formId,
        name: request.name,
        responseDeadline: request.responseDeadline,
        availabilityMessage: request.availabilityMessage,
        respondedAt: request.respondedAt,
        teamIds: request.teamIds,
        teamNames: request.teamNames,
        occurrence: requestOccurrence,
        response: request.availability[requestOccurrence.occurrenceId],
      });
    });
  });

  return [...byOccurrenceId.values()].sort((left, right) =>
    Date.parse(left.startsAt) - Date.parse(right.startsAt) ||
    left.occurrenceId.localeCompare(right.occurrenceId),
  );
};

export const groupMyScheduleByMonth = (
  occurrences: MyScheduleTimelineOccurrence[],
  timeZone: string,
): MyScheduleMonthGroup[] => {
  const groups = new Map<string, MyScheduleMonthGroup>();
  occurrences.forEach((occurrence) => {
    const date = myScheduleOccurrenceDate(occurrence, timeZone);
    if (!date) return;
    const key = date.slice(0, 7);
    let group = groups.get(key);
    if (!group) {
      const monthDate = new Date(`${key}-01T12:00:00.000Z`);
      group = {
        key,
        label: monthDate.toLocaleString(undefined, {
          timeZone: "UTC",
          month: "long",
          year: "numeric",
        }),
        occurrences: [],
      };
      groups.set(key, group);
    }
    group.occurrences.push(occurrence);
  });
  return [...groups.values()].sort((left, right) => left.key.localeCompare(right.key));
};

export const myScheduleServiceGroupKey = (
  occurrence: Pick<MyScheduleOccurrence, "occurrenceId" | "serviceIds" | "name">,
): string => {
  const serviceIds = [...new Set(occurrence.serviceIds)].sort();
  return serviceIds.length ? serviceIds.join("\u0000") : occurrence.name || occurrence.occurrenceId;
};

export const groupMyScheduleByService = (
  occurrences: MyScheduleTimelineOccurrence[],
): MyScheduleServiceGroup[] => {
  const groups = new Map<string, MyScheduleServiceGroup>();
  occurrences.forEach((occurrence) => {
    const key = myScheduleServiceGroupKey(occurrence);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name: occurrence.name || "Service",
        serviceIds: [...new Set(occurrence.serviceIds)].sort(),
        occurrences: [],
      };
      groups.set(key, group);
    }
    group.occurrences.push(occurrence);
  });
  return [...groups.values()].sort((left, right) =>
    left.name.localeCompare(right.name) || left.key.localeCompare(right.key),
  );
};
