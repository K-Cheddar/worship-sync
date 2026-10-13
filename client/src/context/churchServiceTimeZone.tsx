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
        globalInfo.sessionKind === "workstation"),
  );
  const churchIdRef = useRef(churchId);
  churchIdRef.current = churchId;
  const requestIdRef = useRef(0);
  const mountedRef = useRef(false);
  const [requestState, setRequestState] = useState<{
    churchId: string;
    requestId: number;
    status: TimeZoneStatus;
  } | null>(null);
  const [loadedTimeZone, setLoadedTimeZone] = useState<{
    churchId: string;
    timeZone: string;
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
    if (mountedRef.current) {
      setRequestState({ churchId: requestedChurchId, requestId, status: "loading" });
    }
    try {
      const result = await getChurchServiceTimeZone(requestedChurchId);
      if (
        !mountedRef.current ||
        churchIdRef.current !== requestedChurchId ||
        requestIdRef.current !== requestId
      ) return;
      setLoadedTimeZone({
        churchId: requestedChurchId,
        timeZone: result.serviceTimeZone,
        isConfigured: result.isConfigured,
        legacyTimeZoneSuggestion: result.legacyTimeZoneSuggestion || null,
      });
      setRequestState({ churchId: requestedChurchId, requestId, status: "ready" });
    } catch (error) {
      if (
        mountedRef.current &&
        churchIdRef.current === requestedChurchId &&
        requestIdRef.current === requestId
      ) {
        setRequestState({ churchId: requestedChurchId, requestId, status: "error" });
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
        requestId,
        status: churchId ? "error" : "loading",
      });
      return;
    }
    void loadForChurch(churchId).catch(() => undefined);
    return undefined;
  }, [canRead, churchId, loadForChurch]);

  const value = useMemo(
    () => {
      const requestStatus = requestState?.churchId === churchId
        ? requestState.status
        : "loading";
      const hasChurchData = canRead && loadedTimeZone?.churchId === churchId;
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
    [canRead, churchId, loadedTimeZone, refresh, requestState],
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
