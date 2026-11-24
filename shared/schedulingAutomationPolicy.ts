import { calendarDateInTimeZone } from "./teamScheduleOccurrences.ts";

const addCalendarDays = (value: string, days: number) => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "";
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${String(result.getUTCFullYear()).padStart(4, "0")}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
};

/** Shared by processor and timeline previews. Expiration is the first instant
 * of the date after the church-local response deadline. */
export const evaluateAvailabilityRequestTiming = ({
  dueAt,
  responseExpiresAt,
  responseDeadlineLocalDate,
  serviceTimeZone,
  activationAt,
  now = new Date(),
  graceHours = 24,
  catchUpCalendarDays = 7,
}: {
  dueAt?: string | null;
  responseExpiresAt?: string | null;
  responseDeadlineLocalDate?: string | null;
  serviceTimeZone?: string | null;
  activationAt?: string | null;
  now?: Date;
  graceHours?: number;
  catchUpCalendarDays?: number;
}) => {
  const nowMs = now.getTime();
  const dueMs = Date.parse(dueAt || "");
  const expiresMs = Date.parse(responseExpiresAt || "");
  if (!Number.isFinite(dueMs) || !Number.isFinite(expiresMs)) {
    return { eligible: false, status: "review_required" as const, reason: "The saved request timing is invalid; leader review is required." };
  }
  if (activationAt && dueMs < Date.parse(activationAt)) {
    return { eligible: false, status: "review_required" as const, reason: "The request date predates automation activation; leader review is required." };
  }
  if (expiresMs <= nowMs) {
    return { eligible: false, status: "expired" as const, reason: "The availability response window has closed." };
  }
  if (nowMs < dueMs) return { eligible: true, status: "scheduled" as const, reason: null };
  if (nowMs <= dueMs + graceHours * 60 * 60 * 1000) {
    return { eligible: true, status: "on_time" as const, reason: null };
  }

  try {
    const today = calendarDateInTimeZone(now, serviceTimeZone || "UTC");
    const expiryDate = responseDeadlineLocalDate ? addCalendarDays(responseDeadlineLocalDate, 1) : "";
    const minimumExpiryDate = addCalendarDays(today, catchUpCalendarDays);
    if (expiryDate && expiryDate >= minimumExpiryDate) {
      return { eligible: true, status: "catch_up" as const, reason: null };
    }
  } catch {
    // Invalid church timezone should fail closed below.
  }
  return {
    eligible: false,
    status: "review_required" as const,
    reason: `The request is more than ${graceHours} hours overdue and fewer than ${catchUpCalendarDays} full church-local calendar days remain; leader review is required.`,
  };
};
