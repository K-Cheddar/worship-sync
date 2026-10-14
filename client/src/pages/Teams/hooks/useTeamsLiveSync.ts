import { useContext, useEffect, useRef, useState } from "react";
import { GlobalInfoContext } from "../../../context/globalInfo";
import {
  connectAuthenticatedSse,
  type AuthenticatedSseFailure,
} from "../../../utils/authenticatedSse";
import type { TeamSchedule } from "../../../api/authTypes";
export type TeamsStreamEvent =
  | { type: "connected"; churchId?: string }
  | { type: "schedule-updated"; schedule: TeamSchedule }
  | { type: "schedule-removed"; scheduleId: string }
  | { type: "team-positions-reordered" }
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

export type TeamsLiveConnectionFailure =
  | AuthenticatedSseFailure["kind"]
  | null;

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
  const authContext = useContext(GlobalInfoContext);
  const onMessageRef = useRef(onMessage);
  const [connectionState, setConnectionState] =
    useState<TeamsLiveConnectionState>("connecting");
  const [reconnectVersion, setReconnectVersion] = useState(0);
  const [connectionFailure, setConnectionFailure] =
    useState<TeamsLiveConnectionFailure>(null);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    let hasOpened = false;
    let interrupted = false;
    let disposed = false;
    setConnectionState("connecting");
    setReconnectVersion(0);
    setConnectionFailure(null);

    if (!churchId || !canUseTeamsLiveSync) {
      setConnectionState("unavailable");
      return undefined;
    }
    const close = connectAuthenticatedSse(
      `api/churches/${encodeURIComponent(churchId)}/teams/stream`,
      {
        onOpen: () => {
          if (disposed) return;
          if (hasOpened && interrupted) {
            interrupted = false;
            setReconnectVersion((version) => version + 1);
          }
          hasOpened = true;
          setConnectionState("connected");
          setConnectionFailure(null);
        },
        onError: (failure) => {
          if (disposed) return;
          setConnectionFailure(failure.kind);
          if (
            failure.kind === "authentication" ||
            failure.kind === "permission" ||
            (failure.kind === "http" && !failure.retryable) ||
            failure.kind === "invalid-response"
          ) {
            setConnectionState("unavailable");
            return;
          }
          interrupted = true;
          setConnectionState("disconnected");
        },
        onMessage: (rawData) => {
          if (disposed) return;
          try {
            const data = JSON.parse(rawData) as TeamsStreamEvent;
            onMessageRef.current(data);
          } catch {
            onMessageRef.current({ type: "unknown" });
          }
        },
      },
    );

    return () => {
      disposed = true;
      close();
    };
  }, [
    authContext?.access,
    authContext?.canViewTeams,
    authContext?.device?.deviceId,
    authContext?.loginState,
    authContext?.permissions?.teams,
    authContext?.role,
    authContext?.sessionKind,
    authContext?.userId,
    canUseTeamsLiveSync,
    churchId,
  ]);

  return { connectionState, connectionFailure, reconnectVersion };
};
