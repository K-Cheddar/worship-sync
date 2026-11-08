import { useContext, useEffect, useRef, useState } from "react";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  connectAuthenticatedSse,
  type AuthenticatedSseFailure,
} from "../../utils/authenticatedSse";

export type ServicePlanStreamEvent =
  | { type: "connected"; churchId?: string }
  | { type: "service-plan-updated"; planKey: string }
  | { type: "service-plan-removed"; planKey: string }
  | { type: string; [key: string]: unknown };

export type ServicePlanInvalidationEvent = {
  type: "service-plan-updated" | "service-plan-removed";
  planKey: string;
};

export type ServicePlanLiveConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "unavailable";

export type ServicePlanLiveConnectionFailure =
  | AuthenticatedSseFailure["kind"]
  | null;

export const isServicePlanInvalidationEvent = (
  event: ServicePlanStreamEvent,
): event is ServicePlanInvalidationEvent =>
  (event.type === "service-plan-updated" ||
    event.type === "service-plan-removed") &&
  typeof event.planKey === "string";

export const useServicePlanLiveSync = (
  churchId: string | null | undefined,
  onMessage: (event: ServicePlanStreamEvent) => void,
  canViewServices: boolean,
) => {
  const authContext = useContext(GlobalInfoContext);
  const onMessageRef = useRef(onMessage);
  const [connectionState, setConnectionState] =
    useState<ServicePlanLiveConnectionState>("connecting");
  const [connectionFailure, setConnectionFailure] =
    useState<ServicePlanLiveConnectionFailure>(null);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    let disposed = false;
    setConnectionState("connecting");
    setConnectionFailure(null);

    if (!churchId || !canViewServices) {
      setConnectionState("unavailable");
      return undefined;
    }

    const close = connectAuthenticatedSse(
      `api/churches/${encodeURIComponent(churchId)}/services/stream`,
      {
        onOpen: () => {
          if (disposed) return;
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
          setConnectionState("disconnected");
        },
        onMessage: (rawData) => {
          if (disposed) return;
          try {
            onMessageRef.current(JSON.parse(rawData) as ServicePlanStreamEvent);
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
    authContext?.canViewServices,
    authContext?.device?.deviceId,
    authContext?.loginState,
    authContext?.permissions?.services,
    authContext?.role,
    authContext?.sessionKind,
    authContext?.userId,
    canViewServices,
    churchId,
  ]);

  return { connectionState, connectionFailure };
};
