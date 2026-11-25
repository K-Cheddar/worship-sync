import { createHash } from "node:crypto";
import { calendarDateInTimeZone, serviceDateTimeInTimeZone } from "../shared/teamScheduleOccurrences.ts";
import { isValidPortableTimeZone } from "./dataTransfer/time.js";

export const SCHEDULING_CYCLE_SCHEMA_VERSION = 1;
export const DEFAULT_AVAILABILITY_RESPONSE_LEAD_DAYS = 3;

export const DEFAULT_SCHEDULING_AUTOMATION_SETTINGS = Object.freeze({
  frequency: "monthly",
  preparationDay: 24,
  availabilityRequestLeadDays: 14,
  followUpAfterDays: 3,
  leaderSummaryAfterDays: 3,
  availabilityResponseLeadDays: DEFAULT_AVAILABILITY_RESPONSE_LEAD_DAYS,
  localExecutionTime: "09:00",
  publicationPolicy: "manual",
});

export class SchedulingCycleValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchedulingCycleValidationError";
    this.statusCode = 400;
  }
}

const isPlainRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const boundedInteger = (value, field, min, max) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new SchedulingCycleValidationError(`${field} must be a whole number from ${min} to ${max}.`);
  }
  return number;
};

export const normalizeSchedulingAutomationSettings = (input = {}) => {
  if (!isPlainRecord(input)) {
    throw new SchedulingCycleValidationError("Scheduling settings must be an object.");
  }
  const frequency = input.frequency ?? DEFAULT_SCHEDULING_AUTOMATION_SETTINGS.frequency;
  if (frequency !== "monthly") {
    throw new SchedulingCycleValidationError("Monthly scheduling is the only supported frequency.");
  }
  const preparationDay = boundedInteger(
    input.preparationDay ?? DEFAULT_SCHEDULING_AUTOMATION_SETTINGS.preparationDay,
    "Preparation day",
    1,
    31,
  );
  const availabilityRequestLeadDays = boundedInteger(
    input.availabilityRequestLeadDays ?? DEFAULT_SCHEDULING_AUTOMATION_SETTINGS.availabilityRequestLeadDays,
    "Availability request timing",
    1,
    60,
  );
  const followUpAfterDays = boundedInteger(
    input.followUpAfterDays ?? DEFAULT_SCHEDULING_AUTOMATION_SETTINGS.followUpAfterDays,
    "Availability follow-up timing",
    1,
    14,
  );
  const leaderSummaryAfterDays = boundedInteger(
    input.leaderSummaryAfterDays ?? DEFAULT_SCHEDULING_AUTOMATION_SETTINGS.leaderSummaryAfterDays,
    "Leader summary timing",
    1,
    14,
  );
  const availabilityResponseLeadDays = boundedInteger(
    input.availabilityResponseLeadDays ?? DEFAULT_SCHEDULING_AUTOMATION_SETTINGS.availabilityResponseLeadDays,
    "Availability response deadline",
    1,
    14,
  );
  const localExecutionTime = String(
    input.localExecutionTime ?? DEFAULT_SCHEDULING_AUTOMATION_SETTINGS.localExecutionTime,
  ).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(localExecutionTime)) {
    throw new SchedulingCycleValidationError("Execution time must use 24-hour HH:MM format.");
  }
  if (input.publicationPolicy !== undefined && input.publicationPolicy !== "manual") {
    throw new SchedulingCycleValidationError("Schedule publication must remain manual.");
  }
  if (availabilityRequestLeadDays <= (
    followUpAfterDays + leaderSummaryAfterDays + availabilityResponseLeadDays
  )) {
    throw new SchedulingCycleValidationError(
      "Availability must open early enough for the request, follow-up, leader summary, and response deadline before preparation.",
    );
  }
  return {
    frequency,
    preparationDay,
    availabilityRequestLeadDays,
    followUpAfterDays,
    leaderSummaryAfterDays,
    availabilityResponseLeadDays,
    localExecutionTime,
    publicationPolicy: "manual",
  };
};

const validMonth = (periodId) => {
  if (typeof periodId !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId)) return null;
  const [year, month] = periodId.split("-").map(Number);
  if (year < 1900 || year > 9998) return null;
  return { year, month };
};

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const dateString = (year, month, day) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const addCalendarDays = (plainDate, amount) => {
  const [year, month, day] = plainDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return dateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
};

const localTimestamp = (date, time, timeZone) => {
  const instant = serviceDateTimeInTimeZone(date, time, timeZone);
  if (!instant) {
    throw new SchedulingCycleValidationError(
      `Execution time ${time} does not occur on ${date} in ${timeZone}. Choose another local execution time.`,
    );
  }
  return instant.toISOString();
};

/** Return the first instant whose church-local calendar date is `date`.
 * Unlike adding 24 hours, this preserves local-day boundaries across DST.
 * Binary search also handles zones that move clocks forward at midnight.
 */
export const firstInstantOfLocalDate = (date, timeZone) => {
  const midnight = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(midnight) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const exactMidnight = serviceDateTimeInTimeZone(date, "00:00", timeZone);
  if (exactMidnight) return exactMidnight;

  let lower = midnight - 36 * 60 * 60 * 1000;
  let upper = midnight + 36 * 60 * 60 * 1000;
  try {
    if (calendarDateInTimeZone(lower, timeZone) >= date || calendarDateInTimeZone(upper, timeZone) < date) return null;
    while (lower + 1 < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (calendarDateInTimeZone(middle, timeZone) < date) lower = middle;
      else upper = middle;
    }
    return calendarDateInTimeZone(upper, timeZone) === date ? new Date(upper) : null;
  } catch {
    return null;
  }
};

const localDateStartTimestamp = (date, timeZone) => {
  const instant = firstInstantOfLocalDate(date, timeZone);
  if (!instant) {
    throw new SchedulingCycleValidationError(`Could not resolve the start of ${date} in ${timeZone}.`);
  }
  return instant.toISOString();
};

export const schedulingCycleIdFor = ({ churchId, teamId, periodId }) => {
  const church = String(churchId || "").trim();
  const team = String(teamId || "").trim();
  if (!church || !team || !validMonth(periodId)) {
    throw new SchedulingCycleValidationError("Church, team, and monthly period are required to identify a scheduling cycle.");
  }
  const key = `${church}\u0000team\u0000${team}\u0000${periodId}`;
  const digest = createHash("sha256").update(key).digest("hex");
  return `sc_${digest}`;
};

export const schedulingActionIdFor = (cycleId, actionType) => {
  const digest = createHash("sha256").update(`${cycleId}\u0000${actionType}`).digest("hex");
  return `sa_${digest}`;
};

export const schedulingSettingsIdFor = ({ churchId, teamId = "defaults" }) => {
  const scope = teamId === "defaults" ? "church-defaults" : `team:${teamId}`;
  const digest = createHash("sha256").update(`${churchId}\u0000${scope}`).digest("hex");
  return `sas_${digest}`;
};

export const resolveEffectiveSchedulingSettings = ({ defaults, override }) => {
  const normalizedDefaults = normalizeSchedulingAutomationSettings(defaults?.settings || defaults || {});
  const defaultRevision = String(defaults?.revision || "0");
  const mode = override?.mode || "inherit";
  if (mode === "disabled") {
    return {
      mode,
      enabled: false,
      settings: normalizedDefaults,
      configurationRevision: `church:${defaultRevision}:team:${String(override?.revision || "0")}`,
      source: "disabled",
    };
  }
  if (mode === "customize") {
    return {
      mode,
      enabled: true,
      settings: normalizeSchedulingAutomationSettings(override.settings),
      configurationRevision: `church:${defaultRevision}:team:${String(override.revision || "0")}`,
      source: "team",
    };
  }
  if (mode !== "inherit") {
    throw new SchedulingCycleValidationError("Choose inherited, customized, or disabled team settings.");
  }
  return {
    mode: "inherit",
    enabled: true,
    settings: normalizedDefaults,
    configurationRevision: `church:${defaultRevision}`,
    source: "church",
  };
};

export const planSchedulingCycle = ({
  churchId,
  teamId,
  periodId,
  serviceTimeZone,
  effective,
  createdAt = new Date().toISOString(),
  createdBy = null,
}) => {
  const period = validMonth(periodId);
  if (!period) throw new SchedulingCycleValidationError("Choose a valid monthly schedule period.");
  if (!String(churchId || "").trim() || !String(teamId || "").trim()) {
    throw new SchedulingCycleValidationError("Church and team are required to plan a scheduling cycle.");
  }
  if (!isValidPortableTimeZone(serviceTimeZone)) {
    throw new SchedulingCycleValidationError("Set a valid church timezone before planning a scheduling cycle.");
  }

  const settings = normalizeSchedulingAutomationSettings(effective?.settings || {});
  const periodStart = dateString(period.year, period.month, 1);
  const periodEnd = dateString(period.year, period.month, daysInMonth(period.year, period.month));
  const previousMonth = period.month === 1
    ? { year: period.year - 1, month: 12 }
    : { year: period.year, month: period.month - 1 };
  const preparationDay = Math.min(settings.preparationDay, daysInMonth(previousMonth.year, previousMonth.month));
  const preparationDeadline = dateString(previousMonth.year, previousMonth.month, preparationDay);
  const requestDate = addCalendarDays(preparationDeadline, -settings.availabilityRequestLeadDays);
  const followUpDate = addCalendarDays(requestDate, settings.followUpAfterDays);
  const leaderSummaryDate = addCalendarDays(followUpDate, settings.leaderSummaryAfterDays);
  const responseDeadline = addCalendarDays(preparationDeadline, -settings.availabilityResponseLeadDays);

  const cycleId = schedulingCycleIdFor({ churchId, teamId, periodId });
  const responseDeadlineExpiration = addCalendarDays(responseDeadline, 1);
  const draftActions = [
    { actionType: "availability_request", localDate: requestDate, enabled: false, state: "planned" },
    { actionType: "availability_email_delivery", localDate: requestDate, enabled: false, state: "planned" },
    { actionType: "availability_follow_up", localDate: followUpDate, enabled: false, state: "planned" },
    { actionType: "leader_summary", localDate: leaderSummaryDate, enabled: false, state: "planned" },
    { actionType: "availability_response_deadline", localDate: responseDeadline, enabled: false, state: "planned" },
    { actionType: "prepare_schedule_draft", localDate: preparationDeadline, enabled: false, state: "planned" },
    { actionType: "manual_review_and_publish", localDate: null, enabled: false, state: "manual" },
  ];
  const actions = draftActions.map((draft) => {
    const actionId = schedulingActionIdFor(cycleId, draft.actionType);
    const dueAt = draft.actionType === "availability_response_deadline"
      ? localDateStartTimestamp(responseDeadlineExpiration, serviceTimeZone)
      : draft.localDate
        ? localTimestamp(draft.localDate, settings.localExecutionTime, serviceTimeZone)
      : null;
    return {
      actionId,
      id: draft.actionType,
      cycleId,
      churchId,
      teamId,
      periodId,
      actionType: draft.actionType,
      localDate: draft.localDate,
      localTime: draft.actionType === "availability_response_deadline"
        ? null
        : draft.localDate ? settings.localExecutionTime : null,
      serviceTimeZone,
      dueAt,
      state: draft.state,
      enabled: draft.enabled,
      relatedFormId: null,
      relatedScheduleId: null,
      configurationRevision: String(effective?.configurationRevision || "0"),
      idempotencyKey: actionId,
      cancelReason: null,
      supersededByActionId: null,
      attemptCount: 0,
      claimedAt: null,
      claimExpiresAt: null,
      lastAttemptAt: null,
      completedAt: null,
      lastError: null,
      result: null,
      schemaVersion: SCHEDULING_CYCLE_SCHEMA_VERSION,
      createdAt,
      updatedAt: createdAt,
      audit: { createdBy: createdBy || null, updatedBy: createdBy || null },
    };
  });

  return {
    cycle: {
      cycleId,
      churchId,
      scopeType: "team",
      teamId,
      periodId,
      periodStart,
      periodEnd,
      serviceTimeZone,
      configurationRevision: String(effective?.configurationRevision || "0"),
      effectiveConfiguration: settings,
      lifecycleState: "planned",
      automationEnabled: false,
      publicationPolicy: "manual",
      availabilityFormIds: [],
      scheduleIds: [],
      plannedActionIds: actions.map(({ actionId }) => actionId),
      deadlines: {
        preparation: { localDate: preparationDeadline, localTime: settings.localExecutionTime,
          dueAt: localTimestamp(preparationDeadline, settings.localExecutionTime, serviceTimeZone) },
        availabilityRequest: { localDate: requestDate, localTime: settings.localExecutionTime,
          dueAt: localTimestamp(requestDate, settings.localExecutionTime, serviceTimeZone) },
        availabilityFollowUp: { localDate: followUpDate, localTime: settings.localExecutionTime,
          dueAt: localTimestamp(followUpDate, settings.localExecutionTime, serviceTimeZone) },
        leaderSummary: { localDate: leaderSummaryDate, localTime: settings.localExecutionTime,
          dueAt: localTimestamp(leaderSummaryDate, settings.localExecutionTime, serviceTimeZone) },
        availabilityResponse: { localDate: responseDeadline, localTime: null,
          dueAt: localDateStartTimestamp(responseDeadlineExpiration, serviceTimeZone) },
      },
      schemaVersion: SCHEDULING_CYCLE_SCHEMA_VERSION,
      createdAt,
      updatedAt: createdAt,
      audit: { createdBy: createdBy || null, updatedBy: createdBy || null },
    },
    actions,
  };
};
