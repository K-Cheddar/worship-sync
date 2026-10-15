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
import { AuthApiError, getChurchServiceTimeZone } from "../api/auth";
import { GlobalInfoContext } from "./globalInfo";

type TimeZoneStatus = "loading" | "ready" | "error";
export type ChurchServiceTimeZoneIssueKind =
  | "unavailable"
  | "authentication"
  | "permission"
  | "configuration";
export type ChurchServiceTimeZoneRefreshIssue = {
  kind: ChurchServiceTimeZoneIssueKind;
  since: number;
};

type ChurchServiceTimeZoneValue = {
  status: TimeZoneStatus;
  timeZone: string | null;
  isConfigured: boolean;
  legacyTimeZoneSuggestion: string | null;
  refreshIssue: ChurchServiceTimeZoneRefreshIssue | null;
  refresh: () => Promise<void>;
};

const ChurchServiceTimeZoneContext =
  createContext<ChurchServiceTimeZoneValue | null>(null);

const getIssueKind = (error: unknown): ChurchServiceTimeZoneIssueKind => {
  if (!(error instanceof AuthApiError)) return "unavailable";
  if (
    error.isReachabilityError ||
    !error.status ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  ) {
    return "unavailable";
  }
  if (error.status === 401) return "authentication";
  if (error.status === 403) return "permission";
  return "configuration";
};

const REFRESH_RECONNECT_COALESCE_MS = 0;

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
  const inFlightRequestRef = useRef<{
    churchId: string;
    scopeKey: string;
    requestId: number;
    promise: Promise<void>;
  } | null>(null);
  const refreshIssueRef = useRef<{
    churchId: string;
    scopeKey: string;
    issue: ChurchServiceTimeZoneRefreshIssue;
  } | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const [requestState, setRequestState] = useState<{
    churchId: string;
    scopeKey: string;
    requestId: number;
    status: TimeZoneStatus;
  } | null>(null);
  const [loadedTimeZone, setLoadedTimeZone] = useState<{
    churchId: string;
    timeZone: string | null;
    isConfigured: boolean;
    legacyTimeZoneSuggestion: string | null;
  } | null>(null);
  const loadedTimeZoneRef = useRef(loadedTimeZone);
  loadedTimeZoneRef.current = loadedTimeZone;
  const [refreshIssue, setRefreshIssue] = useState<{
    churchId: string;
    scopeKey: string;
    issue: ChurchServiceTimeZoneRefreshIssue;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadForChurch = useCallback((requestedChurchId: string, force = false) => {
    const requestedScope = scopeRef.current;
    const inFlight = inFlightRequestRef.current;
    if (
      inFlight?.churchId === requestedChurchId &&
      inFlight.scopeKey === requestedScope
    ) {
      return inFlight.promise;
    }

    const previousIssue = refreshIssueRef.current;
    if (
      !force &&
      previousIssue?.churchId === requestedChurchId &&
      previousIssue.scopeKey === requestedScope &&
      (previousIssue.issue.kind === "permission" ||
        previousIssue.issue.kind === "configuration")
    ) {
      return Promise.resolve();
    }

    const requestId = ++requestIdRef.current;
    if (mountedRef.current) {
      setRequestState(() => ({
        churchId: requestedChurchId, scopeKey: requestedScope, requestId,
        status: "loading",
      }));
    }
    const promise = (async () => {
      try {
        const result = await getChurchServiceTimeZone(requestedChurchId);
        if (
          !mountedRef.current ||
          churchIdRef.current !== requestedChurchId ||
          scopeRef.current !== requestedScope ||
          requestIdRef.current !== requestId
        ) return;
        const nextTimeZone = {
          churchId: requestedChurchId,
          // The API uses UTC only as a legacy display value when no church
          // setting exists. It is not a configured service timezone and must
          // never drive scheduling or date-derived pages.
          timeZone: result.isConfigured && result.serviceTimeZone
            ? result.serviceTimeZone
            : null,
          isConfigured: result.isConfigured,
          legacyTimeZoneSuggestion: result.legacyTimeZoneSuggestion || null,
        };
        loadedTimeZoneRef.current = nextTimeZone;
        setLoadedTimeZone(nextTimeZone);
        refreshIssueRef.current = null;
        setRefreshIssue(null);
        setRequestState({ churchId: requestedChurchId, scopeKey: requestedScope, requestId, status: "ready" });
      } catch (error) {
        if (
          mountedRef.current &&
          churchIdRef.current === requestedChurchId &&
          scopeRef.current === requestedScope &&
          requestIdRef.current === requestId
        ) {
          const kind = getIssueKind(error);
          const previous = refreshIssueRef.current;
          const issue = {
            kind,
            since: previous?.churchId === requestedChurchId &&
              previous.scopeKey === requestedScope &&
              previous.issue.kind === kind
              ? previous.issue.since
              : Date.now(),
          } satisfies ChurchServiceTimeZoneRefreshIssue;
          refreshIssueRef.current = { churchId: requestedChurchId, scopeKey: requestedScope, issue };
          setRefreshIssue({ churchId: requestedChurchId, scopeKey: requestedScope, issue });
          const hasConfirmedChurchState =
            loadedTimeZoneRef.current?.churchId === requestedChurchId;
          if (!hasConfirmedChurchState) {
            setRequestState({ churchId: requestedChurchId, scopeKey: requestedScope, requestId, status: "error" });
          }
        }
        throw error;
      } finally {
        if (inFlightRequestRef.current?.requestId === requestId) {
          inFlightRequestRef.current = null;
        }
      }
    })();
    inFlightRequestRef.current = {
      churchId: requestedChurchId,
      scopeKey: requestedScope,
      requestId,
      promise,
    };
    return promise;
  }, []);

  const refresh = useCallback(async () => {
    if (!canRead || !churchId || churchIdRef.current !== churchId) return;
    await loadForChurch(churchId, true);
  }, [canRead, churchId, loadForChurch]);

  const scheduleReconnectRefresh = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
    }
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      void loadForChurch(churchId).catch(() => undefined);
    }, REFRESH_RECONNECT_COALESCE_MS);
  }, [churchId, loadForChurch]);

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
    window.addEventListener("online", scheduleReconnectRefresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", scheduleReconnectRefresh);
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [canRead, churchId, loadForChurch, scheduleReconnectRefresh, scopeKey]);

  const realtimeConnected = Boolean(globalInfo?.realtimeConnected);
  const isAuthenticated = globalInfo?.loginState === "success";
  const previousRealtimeConnectedRef = useRef(realtimeConnected);
  useEffect(() => {
    const reconnected = realtimeConnected && !previousRealtimeConnectedRef.current;
    previousRealtimeConnectedRef.current = realtimeConnected;
    if (canRead && reconnected) scheduleReconnectRefresh();
  }, [canRead, realtimeConnected, scheduleReconnectRefresh]);

  const value = useMemo(
    () => {
      const requestStatus = requestState?.scopeKey === scopeKey
        ? requestState.status
        : "loading";
      const hasChurchData = canRead && loadedTimeZone?.churchId === churchId;
      const currentRefreshIssue = !canRead && churchId
        ? {
          kind: isAuthenticated ? "permission" as const : "authentication" as const,
          since: 0,
        }
        : refreshIssue?.churchId === churchId && refreshIssue.scopeKey === scopeKey
          ? refreshIssue.issue
          : null;
      return {
        // A confirmed church-scoped value remains ready during refreshes and
        // failures, so controllers and displays keep using it. Never expose a
        // value from another church.
        status: canRead
          ? hasChurchData ? "ready" : requestStatus
          : churchId ? "error" : "loading",
        timeZone: hasChurchData ? loadedTimeZone.timeZone : null,
        isConfigured: hasChurchData && loadedTimeZone.isConfigured,
        legacyTimeZoneSuggestion: hasChurchData
          ? loadedTimeZone.legacyTimeZoneSuggestion
          : null,
        refreshIssue: currentRefreshIssue,
        refresh,
      };
    },
    [canRead, churchId, isAuthenticated, loadedTimeZone, refresh, refreshIssue, requestState, scopeKey],
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
