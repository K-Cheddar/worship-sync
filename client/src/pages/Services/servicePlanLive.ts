import {
  getServiceFlowProgress,
  type ServiceFlowProgress,
} from "../../services/serviceFlowProgress";
import type { PublicServiceFlow } from "../../services/serviceFlowTypes";
import type { ServicePlan, ServicePlanSection } from "../../types/servicePlan";
import { getServicePlanDurationSeconds } from "./servicePlanDuration";
import { resolvePlanTimelineStartMs } from "./servicePlanTimingUtils";

type PlanLiveSource = {
  name?: string;
  startsAt?: string;
  timezone?: string;
  sections: ServicePlanSection[];
  publicLive?: ServicePlan["publicLive"];
};

/**
 * Same live-item resolution the public/serving pages use: an anchored item
 * restarts the following timeline, a legacy manual pin wins, otherwise the
 * timed schedule follows the planned service start + durations.
 */
export const getServicePlanLiveProgress = (
  plan: PlanLiveSource,
  nowMs: number,
): ServiceFlowProgress | null => {
  if (!plan.startsAt || Number.isNaN(Date.parse(plan.startsAt))) return null;

  const timezone = plan.timezone || "UTC";
  // Matches the public snapshot: the timeline starts at the first element's
  // own time, which can precede the occurrence start.
  const timelineStartMs = resolvePlanTimelineStartMs(
    Date.parse(plan.startsAt),
    timezone,
    plan.sections,
  );

  const flow: PublicServiceFlow = {
    shareId: "",
    title: plan.name || "Service",
    startsAt: plan.startsAt,
    timelineStartsAt: new Date(timelineStartMs).toISOString(),
    timezone,
    revision: 0,
    sections: plan.sections.map((section) => ({
      id: section.id,
      title: section.name,
      items: section.elements.map((element) => ({
        id: element.id,
        title: "",
        durationSeconds: getServicePlanDurationSeconds(element),
        notes: { blocks: [] },
      })),
    })),
    live:
      plan.publicLive?.mode === "manual"
        ? { mode: "manual", currentItemId: plan.publicLive.currentElementId }
        : plan.publicLive?.mode === "anchored"
          ? {
              mode: "anchored",
              currentItemId: plan.publicLive.currentElementId,
              startedAt: plan.publicLive.startedAt,
            }
          : { mode: "schedule" },
  };

  return getServiceFlowProgress(flow, nowMs);
};

export const getServicePlanLiveElementId = (
  plan: PlanLiveSource,
  nowMs: number,
): string | null =>
  getServicePlanLiveProgress(plan, nowMs)?.current?.item.id ?? null;

export const isServicePlanTimelineAdjusted = (
  plan: Pick<ServicePlan, "publicLive"> | null | undefined,
): boolean =>
  plan?.publicLive?.mode === "anchored" &&
  Number.isFinite(Date.parse(plan.publicLive.startedAt));

export const isServicePlanLiveOverridden = (
  plan: Pick<ServicePlan, "publicLive"> | null | undefined,
): boolean =>
  plan?.publicLive?.mode === "manual" || plan?.publicLive?.mode === "anchored";

export const getServicePlanLiveStartedAt = (
  plan: Pick<ServicePlan, "publicLive"> | null | undefined,
): string | null =>
  plan?.publicLive?.mode === "anchored" &&
  Number.isFinite(Date.parse(plan.publicLive.startedAt))
    ? plan.publicLive.startedAt
    : null;

/** @deprecated Prefer isServicePlanLiveOverridden for new UI. */
export const isServicePlanManualLive = (
  plan: Pick<ServicePlan, "publicLive"> | null | undefined,
): boolean => plan?.publicLive?.mode === "manual";
