import type { PlanningCenterPlanSummary } from "../../api/planningCenter";

type LocalServiceTime = {
  date: string;
  time: string;
};

const localServiceTime = (
  startsAt: string,
  timeZone: string,
): LocalServiceTime | null => {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    if (!values.year || !values.month || !values.day || !values.hour || !values.minute) {
      return null;
    }
    return {
      date: `${values.year}-${values.month}-${values.day}`,
      time: `${values.hour}:${values.minute}`,
    };
  } catch {
    return null;
  }
};

export const getPlanningCenterServiceTimesForDate = (
  plan: PlanningCenterPlanSummary,
  date: string,
  timeZone: string,
): string[] => (plan.serviceTimes || []).flatMap(({ startsAt, timeType }) => {
  if (timeType.toLowerCase() !== "service") return [];
  const local = localServiceTime(startsAt, timeZone);
  return local?.date === date ? [local.time] : [];
});

export const resolvePlanningCenterPlanCandidates = (
  plans: PlanningCenterPlanSummary[],
  occurrence: { serviceDate: string; startsAt: string },
  timeZone: string,
): { candidates: PlanningCenterPlanSummary[]; uniqueCandidate: PlanningCenterPlanSummary | null } => {
  const occurrenceLocalTime = localServiceTime(occurrence.startsAt, timeZone);
  if (!occurrence.serviceDate || !occurrenceLocalTime) {
    return { candidates: [], uniqueCandidate: null };
  }

  const uniquePlans = Array.from(
    new Map(plans.map((plan) => [`${plan.serviceTypeId}:${plan.id}`, plan])).values(),
  );
  const dateMatches = uniquePlans.filter((plan) =>
    getPlanningCenterServiceTimesForDate(
      plan,
      occurrence.serviceDate,
      timeZone,
    ).length > 0,
  );
  const exactTimeMatches = dateMatches.filter((plan) =>
    getPlanningCenterServiceTimesForDate(
      plan,
      occurrence.serviceDate,
      timeZone,
    ).includes(occurrenceLocalTime.time),
  );
  // An exact service-time match is stronger evidence than the plan date. A
  // single plan on that date is still a valid fallback when its listed time
  // differs or is absent; multiple date matches remain explicit choices.
  const candidates = exactTimeMatches.length === 1 ? exactTimeMatches : dateMatches;
  return {
    candidates,
    uniqueCandidate: candidates.length === 1 ? candidates[0] : null,
  };
};

export const isValidPlanningCenterId = (value: unknown): value is string =>
  typeof value === "string" && value === value.trim() && /^[A-Za-z0-9_-]{1,64}$/.test(value);

export const planningCenterPlanCandidateKey = (
  plan: Pick<PlanningCenterPlanSummary, "serviceTypeId" | "id">,
) => `${plan.serviceTypeId}:${plan.id}`;
