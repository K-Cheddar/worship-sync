import type { ServicePlan, ServicePlanSummary } from "../../types/servicePlan";

export const CONTROLLER_UPCOMING_PLAN_LIMIT = 10;
export const CONTROLLER_RECENT_PLAN_LIMIT = 10;

const planTime = (plan: ServicePlanSummary): number => {
  const startsAt = "startsAt" in plan ? plan.startsAt : undefined;
  const parsed = Date.parse(startsAt || `${plan.date}T23:59:59`);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const isControllerServicePlanUpcoming = (
  plan: ServicePlanSummary,
  nowMs = Date.now(),
): boolean => planTime(plan) >= nowMs;

/** Upcoming first (soonest first), followed by recent plans (newest first). */
export const sortControllerServicePlans = (
  plans: ServicePlanSummary[],
  nowMs = Date.now(),
): ServicePlanSummary[] =>
  [...plans].sort((left, right) => {
    const leftTime = planTime(left);
    const rightTime = planTime(right);
    const leftUpcoming = leftTime >= nowMs;
    const rightUpcoming = rightTime >= nowMs;
    if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
    return leftUpcoming ? leftTime - rightTime : rightTime - leftTime;
  });

/**
 * Keeps the controller picker bounded without hiding the plan that explains
 * the current context. A manually selected or outline-linked plan may extend
 * the limits, so an older outline never opens with an unrepresentable value.
 */
export const limitControllerServicePlans = ({
  plans,
  selectedPlanKey,
  boundPlanKey,
  nowMs = Date.now(),
  upcomingLimit = CONTROLLER_UPCOMING_PLAN_LIMIT,
  recentLimit = CONTROLLER_RECENT_PLAN_LIMIT,
}: {
  plans: ServicePlanSummary[];
  selectedPlanKey?: string | null;
  boundPlanKey?: string | null;
  nowMs?: number;
  upcomingLimit?: number;
  recentLimit?: number;
}): ServicePlanSummary[] => {
  const sorted = sortControllerServicePlans(plans, nowMs);
  const visible = [
    ...sorted
      .filter((plan) => isControllerServicePlanUpcoming(plan, nowMs))
      .slice(0, upcomingLimit),
    ...sorted
      .filter((plan) => !isControllerServicePlanUpcoming(plan, nowMs))
      .slice(0, recentLimit),
  ];
  const visibleKeys = new Set(visible.map((plan) => plan.planKey));

  for (const requiredKey of [selectedPlanKey, boundPlanKey]) {
    if (!requiredKey || visibleKeys.has(requiredKey)) continue;
    const requiredPlan = sorted.find((plan) => plan.planKey === requiredKey);
    if (!requiredPlan) continue;
    visible.push(requiredPlan);
    visibleKeys.add(requiredKey);
  }

  return sortControllerServicePlans(visible, nowMs);
};

export const chooseControllerServicePlanKey = ({
  plans,
  boundPlanKey,
  currentOccurrencePlanKey,
  nowMs = Date.now(),
}: {
  plans: ServicePlanSummary[];
  boundPlanKey?: string | null;
  currentOccurrencePlanKey?: string | null;
  nowMs?: number;
}): string | null => {
  const keys = new Set(plans.map((plan) => plan.planKey));
  if (boundPlanKey && keys.has(boundPlanKey)) return boundPlanKey;
  if (currentOccurrencePlanKey && keys.has(currentOccurrencePlanKey)) {
    return currentOccurrencePlanKey;
  }
  return sortControllerServicePlans(plans, nowMs)[0]?.planKey ?? null;
};

export const servicePlanToSummary = (plan: ServicePlan): ServicePlanSummary => ({
  planKey: plan.planKey,
  serviceId: plan.serviceId,
  serviceIds: plan.serviceIds,
  groupId: plan.groupId,
  date: plan.date,
  name: plan.name,
  startsAt: plan.startsAt,
  published: plan.published,
});

export const formatControllerServicePlanLabel = (
  plan: ServicePlanSummary,
): string => {
  const dateSource = plan.startsAt || `${plan.date}T12:00:00`;
  const parsed = Date.parse(dateSource);
  const dateLabel = Number.isFinite(parsed)
    ? new Date(parsed).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        ...(plan.startsAt
          ? { hour: "numeric", minute: "2-digit" }
          : {}),
      })
    : plan.date;
  return `${plan.name?.trim() || "Service plan"} · ${dateLabel}`;
};
