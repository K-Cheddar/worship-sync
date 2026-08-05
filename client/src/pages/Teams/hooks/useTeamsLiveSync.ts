import { useEffect, useRef } from "react";
import { getApiBasePath } from "../../../utils/environment";
import type { TeamSchedule } from "../../../api/authTypes";
import type {
  ServicePlan,
  ServicePlanTemplate,
} from "../../../types/servicePlan";

export type TeamsStreamEvent =
  | { type: "connected"; churchId?: string }
  | { type: "schedule-updated"; schedule: TeamSchedule }
  | { type: "schedule-removed"; scheduleId: string }
  | { type: "service-plan-updated"; servicePlan: ServicePlan }
  | { type: "service-plan-removed"; planKey: string }
  | { type: "service-plan-template-updated"; template: ServicePlanTemplate }
  | { type: "service-plan-template-removed"; templateId: string }
  | { type: string; [key: string]: unknown };

export type ServicePlanUpdatedEvent = {
  type: "service-plan-updated";
  servicePlan: ServicePlan;
};

export type ServicePlanTemplateUpdatedEvent = {
  type: "service-plan-template-updated";
  template: ServicePlanTemplate;
};

export type ServicePlanTemplateRemovedEvent = {
  type: "service-plan-template-removed";
  templateId: string;
};

/**
 * The union ends in an open `{ type: string; [key: string]: unknown }` member
 * so unknown server events don't break consumers — but that also means a
 * `event.type === "…"` check can't narrow, and the payload reads as `unknown`.
 * This asserts the shape explicitly instead.
 */
export const isServicePlanUpdatedEvent = (
  event: TeamsStreamEvent,
): event is ServicePlanUpdatedEvent => {
  if (event.type !== "service-plan-updated") return false;
  const servicePlan = (event as { servicePlan?: unknown }).servicePlan;
  return Boolean(servicePlan) && typeof servicePlan === "object";
};

export const isServicePlanTemplateUpdatedEvent = (
  event: TeamsStreamEvent,
): event is ServicePlanTemplateUpdatedEvent => {
  if (event.type !== "service-plan-template-updated") return false;
  const template = (event as { template?: unknown }).template;
  return (
    Boolean(template)
    && typeof template === "object"
    && typeof (template as ServicePlanTemplate).templateId === "string"
  );
};

export const isServicePlanTemplateRemovedEvent = (
  event: TeamsStreamEvent,
): event is ServicePlanTemplateRemovedEvent =>
  event.type === "service-plan-template-removed"
  && typeof (event as { templateId?: unknown }).templateId === "string";

/**
 * Subscribes to the church's Teams live channel (SSE). The server pushes
 * schedule mutations made by other admins so the scheduling grid collaborates
 * in real time. Mirrors `useBoardEventStream` — see server/teamsSse.js for the
 * emitter and server.js for the `/api/churches/:churchId/teams/stream` route.
 */
export const useTeamsLiveSync = (
  churchId: string | null | undefined,
  onMessage: (event: TeamsStreamEvent) => void,
) => {
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!churchId) return;
    // EventSource is absent in some runtimes (jsdom/tests, older webviews). The
    // page still works via background polling, so just skip the live channel.
    if (typeof EventSource === "undefined") return;

    const source = new EventSource(
      `${getApiBasePath()}api/churches/${encodeURIComponent(churchId)}/teams/stream`,
      { withCredentials: true },
    );

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as TeamsStreamEvent;
        onMessageRef.current(data);
      } catch {
        onMessageRef.current({ type: "unknown" });
      }
    };

    return () => {
      source.close();
    };
  }, [churchId]);
};
