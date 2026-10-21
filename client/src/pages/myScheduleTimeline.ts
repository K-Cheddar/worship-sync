import type { MyScheduleOccurrence } from "../api/auth";

export type MyScheduleMonthGroup = {
  key: string;
  label: string;
  occurrences: MyScheduleOccurrence[];
};

export type MyScheduleServiceGroup = {
  key: string;
  name: string;
  serviceIds: string[];
  occurrences: MyScheduleOccurrence[];
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
  occurrence: Pick<MyScheduleOccurrence, "date" | "startsAt">,
  timeZone: string,
): string =>
  isPlainDate(occurrence.date)
    ? occurrence.date
    : dateInTimeZone(occurrence.startsAt, timeZone);

export const groupMyScheduleByMonth = (
  occurrences: MyScheduleOccurrence[],
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
  occurrences: MyScheduleOccurrence[],
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
