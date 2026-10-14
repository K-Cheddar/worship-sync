import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getChurchServiceTimeZone } from "../api/auth";
import { GlobalInfoContext } from "./globalInfo";

type TimeZoneStatus = "loading" | "ready" | "error";

type ChurchServiceTimeZoneValue = {
  status: TimeZoneStatus;
  timeZone: string | null;
  isConfigured: boolean;
  legacyTimeZoneSuggestion: string | null;
  refresh: () => Promise<void>;
};

const ChurchServiceTimeZoneContext =
  createContext<ChurchServiceTimeZoneValue | null>(null);

export const ChurchServiceTimeZoneProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const globalInfo = useContext(GlobalInfoContext);
  const churchId = globalInfo?.churchId || "";
  const canRead = Boolean(
    churchId &&
      globalInfo?.loginState === "success" &&
      (globalInfo.sessionKind === "human" ||
        globalInfo.sessionKind === "workstation" ||
        globalInfo.sessionKind === "display"),
  );
  const churchIdRef = useRef(churchId);
  churchIdRef.current = churchId;
  const scopeKey = JSON.stringify([churchId, globalInfo?.loginState, globalInfo?.sessionKind, globalInfo?.device?.deviceId]);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);
  const [requestState, setRequestState] = useState<{
    churchId: string;
    scopeKey: string;
    requestId: number;
    status: TimeZoneStatus;
  } | null>(null);
  const [loadedTimeZone, setLoadedTimeZone] = useState<{
    churchId: string;
    scopeKey: string;
    timeZone: string | null;
    isConfigured: boolean;
    legacyTimeZoneSuggestion: string | null;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadForChurch = useCallback(async (requestedChurchId: string) => {
    const requestId = ++requestIdRef.current;
    const requestedScope = scopeRef.current;
    if (mountedRef.current) {
      setRequestState((previous) => ({
        churchId: requestedChurchId, scopeKey: requestedScope, requestId,
        status: previous?.scopeKey === requestedScope ? previous.status : "loading",
      }));
    }
    try {
      const result = await getChurchServiceTimeZone(requestedChurchId);
      if (
        !mountedRef.current ||
        churchIdRef.current !== requestedChurchId ||
        scopeRef.current !== requestedScope ||
        requestIdRef.current !== requestId
      ) return;
      setLoadedTimeZone({
        churchId: requestedChurchId,
        scopeKey: requestedScope,
        // The API uses UTC only as a legacy display value when no church
        // setting exists. It is not a configured service timezone and must
        // never drive scheduling or date-derived pages.
        timeZone: result.isConfigured && result.serviceTimeZone
          ? result.serviceTimeZone
          : null,
        isConfigured: result.isConfigured,
        legacyTimeZoneSuggestion: result.legacyTimeZoneSuggestion || null,
      });
      setRequestState({ churchId: requestedChurchId, scopeKey: requestedScope, requestId, status: "ready" });
    } catch (error) {
      if (
        mountedRef.current &&
        churchIdRef.current === requestedChurchId &&
        scopeRef.current === requestedScope &&
        requestIdRef.current === requestId
      ) {
        setRequestState({ churchId: requestedChurchId, scopeKey: requestedScope, requestId, status: "error" });
      }
      throw error;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!canRead || !churchId || churchIdRef.current !== churchId) return;
    await loadForChurch(churchId);
  }, [canRead, churchId, loadForChurch]);

  useEffect(() => {
    if (!canRead) {
      const requestId = ++requestIdRef.current;
      setRequestState({
        churchId,
        scopeKey,
        requestId,
        status: churchId ? "error" : "loading",
      });
      return;
    }
    void loadForChurch(churchId).catch(() => undefined);
    // Revalidate credentials and settings even on passive, long-running outputs.
    const reload = () => { void loadForChurch(churchId).catch(() => undefined); };
    const interval = window.setInterval(reload, 60_000);
    window.addEventListener("online", reload);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", reload);
    };
  }, [canRead, churchId, loadForChurch, scopeKey, globalInfo?.realtimeConnected]);

  const value = useMemo(
    () => {
      const requestStatus = requestState?.scopeKey === scopeKey
        ? requestState.status
        : "loading";
      const hasChurchData = canRead && loadedTimeZone?.scopeKey === scopeKey;
      return {
        status: canRead ? requestStatus : churchId ? "error" : "loading",
        // Keep the last good value visible during a refresh or a transient
        // failure, but never expose another church's cached setting.
        timeZone: hasChurchData ? loadedTimeZone.timeZone : null,
        isConfigured: hasChurchData && loadedTimeZone.isConfigured,
        legacyTimeZoneSuggestion: hasChurchData
          ? loadedTimeZone.legacyTimeZoneSuggestion
          : null,
        refresh,
      };
    },
    [canRead, churchId, loadedTimeZone, refresh, requestState, scopeKey],
  );

  return (
    <ChurchServiceTimeZoneContext.Provider value={value}>
      {children}
    </ChurchServiceTimeZoneContext.Provider>
  );
};

export const useChurchServiceTimeZone = () => {
  const value = useContext(ChurchServiceTimeZoneContext);
  if (!value) {
    throw new Error(
      "useChurchServiceTimeZone must be used within ChurchServiceTimeZoneProvider.",
    );
  }
  return value;
};
