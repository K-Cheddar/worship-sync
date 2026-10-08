import { useEffect, useRef, useState } from "react";
import { getApiBasePath } from "../../../utils/environment";
import type { TeamSchedule } from "../../../api/authTypes";
export type TeamsStreamEvent =
  | { type: "connected"; churchId?: string }
  | { type: "schedule-updated"; schedule: TeamSchedule }
  | { type: "schedule-removed"; scheduleId: string }
  | { type: "service-plan-updated"; planKey: string; saveOperationId?: string }
  | { type: "service-plan-removed"; planKey: string }
  | { type: "service-plan-template-updated"; templateId: string }
  | { type: "service-plan-template-removed"; templateId: string }
  | { type: string; [key: string]: unknown };

export type ServicePlanUpdatedEvent = {
  type: "service-plan-updated";
  planKey: string;
  saveOperationId?: string;
};

export type ServicePlanTemplateUpdatedEvent = {
  type: "service-plan-template-updated";
  templateId: string;
};

export type ServicePlanTemplateRemovedEvent = {
  type: "service-plan-template-removed";
  templateId: string;
};

export type TeamsLiveConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "unavailable";

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
  return typeof (event as { planKey?: unknown }).planKey === "string";
};

export const isServicePlanTemplateUpdatedEvent = (
  event: TeamsStreamEvent,
): event is ServicePlanTemplateUpdatedEvent => {
  if (event.type !== "service-plan-template-updated") return false;
  return typeof (event as { templateId?: unknown }).templateId === "string";
};

export const isServicePlanTemplateRemovedEvent = (
  event: TeamsStreamEvent,
): event is ServicePlanTemplateRemovedEvent =>
  event.type === "service-plan-template-removed"
  && typeof (event as { templateId?: unknown }).templateId === "string";

/**
 * Requires the broad session capability: scoped readers use projected REST.
 * Subscribes to the church's Teams live channel (SSE). The server pushes
 * schedule documents and Services change notifications. Mirrors
 * `useBoardEventStream` — see server/teamsSse.js for the
 * emitter and server.js for the `/api/churches/:churchId/teams/stream` route.
 */
export const useTeamsLiveSync = (
  churchId: string | null | undefined,
  onMessage: (event: TeamsStreamEvent) => void,
  canUseTeamsLiveSync: boolean,
) => {
  const onMessageRef = useRef(onMessage);
  const [connectionState, setConnectionState] =
    useState<TeamsLiveConnectionState>("connecting");
  const [reconnectVersion, setReconnectVersion] = useState(0);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    let hasOpened = false;
    let interrupted = false;
    let disposed = false;
    setConnectionState("connecting");
    setReconnectVersion(0);

    if (!churchId || !canUseTeamsLiveSync) {
      setConnectionState("unavailable");
      return undefined;
    }
    // Some runtimes (including older webviews) do not provide EventSource.
    // Consumers can then use a bounded REST fallback when their snapshot ages.
    if (typeof EventSource === "undefined") {
      setConnectionState("unavailable");
      return undefined;
    }

    const source = new EventSource(
      `${getApiBasePath()}api/churches/${encodeURIComponent(churchId)}/teams/stream`,
      { withCredentials: true },
    );

    source.onopen = () => {
      if (disposed) return;
      if (hasOpened && interrupted) {
        interrupted = false;
        setReconnectVersion((version) => version + 1);
      }
      hasOpened = true;
      setConnectionState("connected");
    };

    source.onerror = () => {
      if (disposed || !hasOpened || interrupted) return;
      interrupted = true;
      setConnectionState("disconnected");
    };

    source.onmessage = (event) => {
      if (disposed) return;
      try {
        const data = JSON.parse(event.data) as TeamsStreamEvent;
        onMessageRef.current(data);
      } catch {
        onMessageRef.current({ type: "unknown" });
      }
    };

    return () => {
      disposed = true;
      source.close();
    };
  }, [churchId, canUseTeamsLiveSync]);

  return { connectionState, reconnectVersion };
};
