import { getServiceFlowProgress } from "../../services/serviceFlowProgress";
import type { PublicServiceFlow } from "../../services/serviceFlowTypes";
import type { ServicePlan, ServicePlanSection } from "../../types/servicePlan";
import { getServicePlanDurationSeconds } from "./servicePlanDuration";

type PlanLiveSource = {
  name?: string;
  startsAt?: string;
  timezone?: string;
  sections: ServicePlanSection[];
  publicLive?: ServicePlan["publicLive"];
};

/**
 * Same live-item resolution the public/serving pages use: a manual pin wins,
 * otherwise the timed schedule from service start + durations.
 */
export const getServicePlanLiveElementId = (
  plan: PlanLiveSource,
  nowMs: number,
): string | null => {
  if (!plan.startsAt || Number.isNaN(Date.parse(plan.startsAt))) return null;

  const flow: PublicServiceFlow = {
    shareId: "",
    title: plan.name || "Service",
    startsAt: plan.startsAt,
    timezone: plan.timezone || "UTC",
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
        : { mode: "schedule" },
  };

  return getServiceFlowProgress(flow, nowMs).current?.item.id ?? null;
};

export const isServicePlanManualLive = (
  plan: Pick<ServicePlan, "publicLive"> | null | undefined,
): boolean => plan?.publicLive?.mode === "manual";
