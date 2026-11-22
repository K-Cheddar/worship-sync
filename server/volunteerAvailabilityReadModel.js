import { calendarDateInTimeZone } from "../shared/teamScheduleOccurrences.ts";
import { isValidPortableTimeZone } from "./dataTransfer/time.js";
import { mapWithConcurrency } from "./scheduleInitialSms.js";

export const VOLUNTEER_AVAILABILITY_READ_CONCURRENCY = 6;

export const mapVolunteerAvailabilityReads = (values, operation) =>
  mapWithConcurrency(values, VOLUNTEER_AVAILABILITY_READ_CONCURRENCY, operation);

export const getVolunteerAvailabilityCurrentDate = (timeZone, now = new Date()) => {
  if (isValidPortableTimeZone(timeZone)) {
    return calendarDateInTimeZone(now, timeZone);
  }
  return new Date(now).toISOString().slice(0, 10);
};

export const isVolunteerAvailabilityFormCurrent = (form, currentDate) => {
  const deadline = String(form?.responseDeadline || form?.endDate || "").trim();
  return Boolean(
    form?.active &&
    !form?.archivedAt &&
    (!deadline || deadline >= currentDate),
  );
};
