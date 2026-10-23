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
import {
  AuthApiError,
  getChurchServiceTimeZone,
  type ChurchServiceTimeZoneResponse,
} from "../api/auth";
import { getDisplayToken } from "../utils/authStorage";
import {
  connectAuthenticatedSse,
  type AuthenticatedSseFailure,
} from "../utils/authenticatedSse";
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

type LoadedTimeZone = {
  churchId: string;
  scopeKey: string;
  timeZone: string | null;
  isConfigured: boolean;
  legacyTimeZoneSuggestion: string | null;
  serviceTimeZoneRevision: string;
};

type ScopedRefreshIssue = {
  churchId: string;
  scopeKey: string;
  issue: ChurchServiceTimeZoneRefreshIssue;
};

type InFlightRequest = {
  churchId: string;
  scopeKey: string;
  requestId: number;
  promise: Promise<void>;
};

type ChurchServiceTimeZoneValue = {
  status: TimeZoneStatus;
  timeZone: string | null;
  isConfigured: boolean;
  legacyTimeZoneSuggestion: string | null;
  refreshIssue: ChurchServiceTimeZoneRefreshIssue | null;
  refresh: () => Promise<void>;
  adoptSavedTimeZone: (result: ChurchServiceTimeZoneResponse) => void;
};

const ChurchServiceTimeZoneContext =
  createContext<ChurchServiceTimeZoneValue | null>(null);

const LEGACY_SERVICE_TIME_ZONE_REVISION = "legacy";

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

const getSseIssueKind = (
  failure: AuthenticatedSseFailure,
): ChurchServiceTimeZoneIssueKind => {
  if (failure.kind === "authentication") return "authentication";
  if (failure.kind === "permission") return "permission";
  if (failure.kind === "http") {
    return failure.retryable ? "unavailable" : "configuration";
  }
  if (failure.kind === "invalid-response") return "configuration";
  return "unavailable";
};

const getRevision = (result: ChurchServiceTimeZoneResponse) =>
  typeof result.serviceTimeZoneRevision === "string" &&
  result.serviceTimeZoneRevision
    ? result.serviceTimeZoneRevision
    : LEGACY_SERVICE_TIME_ZONE_REVISION;

export const ChurchServiceTimeZoneProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const globalInfo = useContext(GlobalInfoContext);
  const churchId = globalInfo?.churchId || "";
  const loginState = globalInfo?.loginState || "";
  const sessionKind = globalInfo?.sessionKind || "";
  const userId = sessionKind === "human" ? globalInfo?.userId || "" : "";
  const deviceId = globalInfo?.device?.deviceId || "";
  const displayToken = getDisplayToken();
  const canRead = Boolean(
    churchId &&
      loginState === "success" &&
      (sessionKind === "human" ||
        sessionKind === "workstation" ||
        sessionKind === "display"),
  );
  const scopeKey = JSON.stringify([
    churchId,
    loginState,
    sessionKind,
    userId,
    deviceId,
  ]);

  const canReadRef = useRef(canRead);
  canReadRef.current = canRead;
  const churchIdRef = useRef(churchId);
  churchIdRef.current = churchId;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const requestIdRef = useRef(0);
  const inFlightRequestRef = useRef<InFlightRequest | null>(null);
  const latestObservedRevisionRef = useRef<{
    scopeKey: string;
    revision: string;
  } | null>(null);
  const initialLoadScopeRef = useRef<string | null>(null);
  const refreshIssueRef = useRef<ScopedRefreshIssue | null>(null);
  const mountedRef = useRef(false);
  const [streamRestartEpoch, setStreamRestartEpoch] = useState(0);
  const [requestState, setRequestState] = useState<{
    churchId: string;
    scopeKey: string;
    requestId: number;
    status: TimeZoneStatus;
  } | null>(null);
  const [loadedTimeZone, setLoadedTimeZone] = useState<LoadedTimeZone | null>(
    null,
  );
  const loadedTimeZoneRef = useRef(loadedTimeZone);
  loadedTimeZoneRef.current = loadedTimeZone;
  const [refreshIssue, setRefreshIssue] = useState<ScopedRefreshIssue | null>(
    null,
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const recordIssue = useCallback((
    requestedChurchId: string,
    requestedScope: string,
    kind: ChurchServiceTimeZoneIssueKind,
  ) => {
    const previous = refreshIssueRef.current;
    const issue = {
      kind,
      since:
        previous?.churchId === requestedChurchId &&
        previous.scopeKey === requestedScope &&
        previous.issue.kind === kind
          ? previous.issue.since
          : Date.now(),
    } satisfies ChurchServiceTimeZoneRefreshIssue;
    const nextIssue = {
      churchId: requestedChurchId,
      scopeKey: requestedScope,
      issue,
    };
    refreshIssueRef.current = nextIssue;
    setRefreshIssue(nextIssue);
  }, []);

  const clearIssue = useCallback((requestedScope: string, onlyUnavailable = false) => {
    const current = refreshIssueRef.current;
    if (
      current?.scopeKey !== requestedScope ||
      (onlyUnavailable && current.issue.kind !== "unavailable")
    ) {
      return;
    }
    refreshIssueRef.current = null;
    setRefreshIssue(null);
  }, []);

  const loadForChurch = useCallback((
    requestedChurchId: string,
    force = false,
    retriedRevision?: string,
  ): Promise<void> => {
    if (
      !mountedRef.current ||
      !canReadRef.current ||
      requestedChurchId !== churchIdRef.current
    ) {
      return Promise.resolve();
    }

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
      previousIssue.issue.kind !== "unavailable"
    ) {
      return Promise.resolve();
    }

    const requestId = ++requestIdRef.current;
    setRequestState({
      churchId: requestedChurchId,
      scopeKey: requestedScope,
      requestId,
      status: "loading",
    });

    let followUpRevision: string | null = null;
    const promise = (async () => {
      try {
        const result = await getChurchServiceTimeZone(requestedChurchId);
        if (
          !mountedRef.current ||
          churchIdRef.current !== requestedChurchId ||
          scopeRef.current !== requestedScope ||
          requestIdRef.current !== requestId
        ) {
          return;
        }

        const serviceTimeZoneRevision = getRevision(result);
        const observedRevision = latestObservedRevisionRef.current;
        if (
          observedRevision?.scopeKey === requestedScope &&
          observedRevision.revision !== serviceTimeZoneRevision &&
          retriedRevision !== observedRevision.revision
        ) {
          followUpRevision = observedRevision.revision;
          return;
        }

        const nextTimeZone: LoadedTimeZone = {
          churchId: requestedChurchId,
          scopeKey: requestedScope,
          // The API uses UTC only as a legacy display value when no church
          // setting exists. It is not a configured service timezone and must
          // never drive scheduling or date-derived pages.
          timeZone:
            result.isConfigured && result.serviceTimeZone
              ? result.serviceTimeZone
              : null,
          isConfigured: result.isConfigured,
          legacyTimeZoneSuggestion: result.legacyTimeZoneSuggestion || null,
          serviceTimeZoneRevision,
        };
        loadedTimeZoneRef.current = nextTimeZone;
        setLoadedTimeZone(nextTimeZone);
        if (observedRevision?.scopeKey !== requestedScope) {
          latestObservedRevisionRef.current = {
            scopeKey: requestedScope,
            revision: serviceTimeZoneRevision,
          };
        }
        clearIssue(requestedScope);
        setRequestState({
          churchId: requestedChurchId,
          scopeKey: requestedScope,
          requestId,
          status: "ready",
        });
      } catch (error) {
        if (
          mountedRef.current &&
          churchIdRef.current === requestedChurchId &&
          scopeRef.current === requestedScope &&
          requestIdRef.current === requestId
        ) {
          const kind = getIssueKind(error);
          recordIssue(requestedChurchId, requestedScope, kind);
          if (loadedTimeZoneRef.current?.scopeKey !== requestedScope) {
            setRequestState({
              churchId: requestedChurchId,
              scopeKey: requestedScope,
              requestId,
              status: "error",
            });
          }
        }
        throw error;
      } finally {
        if (inFlightRequestRef.current?.requestId === requestId) {
          inFlightRequestRef.current = null;
        }
        if (
          followUpRevision &&
          mountedRef.current &&
          canReadRef.current &&
          churchIdRef.current === requestedChurchId &&
          scopeRef.current === requestedScope
        ) {
          void loadForChurch(
            requestedChurchId,
            false,
            followUpRevision,
          ).catch(() => undefined);
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
  }, [clearIssue, recordIssue]);

  const refresh = useCallback(async () => {
    if (
      !canRead ||
      !churchId ||
      churchIdRef.current !== churchId ||
      scopeRef.current !== scopeKey
    ) {
      return;
    }
    const requestedScope = scopeKey;
    await loadForChurch(churchId, true);
    if (
      mountedRef.current &&
      canReadRef.current &&
      scopeRef.current === requestedScope
    ) {
      setStreamRestartEpoch((epoch) => epoch + 1);
    }
  }, [canRead, churchId, loadForChurch, scopeKey]);

  const adoptSavedTimeZone = useCallback((result: ChurchServiceTimeZoneResponse) => {
    if (
      !mountedRef.current ||
      !canReadRef.current ||
      !churchId ||
      churchIdRef.current !== churchId ||
      scopeRef.current !== scopeKey
    ) {
      return;
    }
    const requestedChurchId = churchId;
    const requestedScope = scopeKey;
    const requestId = ++requestIdRef.current;
    inFlightRequestRef.current = null;
    const serviceTimeZoneRevision = getRevision(result);
    const nextTimeZone: LoadedTimeZone = {
      churchId: requestedChurchId,
      scopeKey: requestedScope,
      timeZone:
        result.isConfigured && result.serviceTimeZone
          ? result.serviceTimeZone
          : null,
      isConfigured: result.isConfigured,
      legacyTimeZoneSuggestion: result.legacyTimeZoneSuggestion || null,
      serviceTimeZoneRevision,
    };
    loadedTimeZoneRef.current = nextTimeZone;
    latestObservedRevisionRef.current = {
      scopeKey: requestedScope,
      revision: serviceTimeZoneRevision,
    };
    setLoadedTimeZone(nextTimeZone);
    clearIssue(requestedScope);
    setRequestState({
      churchId: requestedChurchId,
      scopeKey: requestedScope,
      requestId,
      status: "ready",
    });
  }, [churchId, clearIssue, scopeKey]);

  useEffect(() => {
    if (!canRead) {
      initialLoadScopeRef.current = null;
      const requestId = ++requestIdRef.current;
      inFlightRequestRef.current = null;
      loadedTimeZoneRef.current = null;
      refreshIssueRef.current = null;
      setLoadedTimeZone(null);
      setRefreshIssue(null);
      setRequestState({
        churchId,
        scopeKey,
        requestId,
        status: churchId ? "error" : "loading",
      });
      return;
    }

    const effectScope = scopeKey;
    const effectChurchId = churchId;
    if (initialLoadScopeRef.current !== effectScope) {
      initialLoadScopeRef.current = effectScope;
      void loadForChurch(effectChurchId).catch(() => undefined);
    }
    const closeStream = connectAuthenticatedSse(
      `api/churches/${effectChurchId}/service-time-zone/stream`,
      {
        onOpen: () => {
          clearIssue(effectScope, true);
        },
        onMessage: (message) => {
          let event: unknown;
          try {
            event = JSON.parse(message);
          } catch {
            return;
          }
          if (
            !event ||
            typeof event !== "object" ||
            (event as { type?: unknown }).type !==
              "service-time-zone-revision" ||
            (event as { churchId?: unknown }).churchId !== effectChurchId ||
            typeof (event as { serviceTimeZoneRevision?: unknown })
              .serviceTimeZoneRevision !== "string" ||
            !canReadRef.current ||
            scopeRef.current !== effectScope
          ) {
            return;
          }

          const revision = (event as {
            serviceTimeZoneRevision: string;
          }).serviceTimeZoneRevision;
          latestObservedRevisionRef.current = {
            scopeKey: effectScope,
            revision,
          };
          const loaded = loadedTimeZoneRef.current;
          if (
            loaded?.scopeKey === effectScope &&
            loaded.serviceTimeZoneRevision === revision
          ) {
            return;
          }
          const currentIssue = refreshIssueRef.current;
          if (
            currentIssue?.scopeKey === effectScope &&
            currentIssue.issue.kind !== "unavailable"
          ) {
            return;
          }
          const inFlight = inFlightRequestRef.current;
          if (
            inFlight?.scopeKey === effectScope &&
            inFlight.churchId === effectChurchId
          ) {
            return;
          }
          void loadForChurch(effectChurchId).catch(() => undefined);
        },
        onError: (failure) => {
          if (scopeRef.current !== effectScope || !canReadRef.current) return;
          recordIssue(
            effectChurchId,
            effectScope,
            getSseIssueKind(failure),
          );
        },
      },
      displayToken ? { "x-display-token": displayToken } : undefined,
    );

    return () => {
      closeStream();
    };
  }, [
    canRead,
    churchId,
    clearIssue,
    displayToken,
    loadForChurch,
    recordIssue,
    scopeKey,
    streamRestartEpoch,
  ]);

  const isAuthenticated = loginState === "success";
  const value = useMemo(() => {
    const requestStatus =
      requestState?.scopeKey === scopeKey ? requestState.status : "loading";
    const hasScopeData =
      canRead && loadedTimeZone?.scopeKey === scopeKey;
    const currentRefreshIssue = !canRead && churchId
      ? {
          kind: isAuthenticated
            ? ("permission" as const)
            : ("authentication" as const),
          since: 0,
        }
      : refreshIssue?.churchId === churchId && refreshIssue.scopeKey === scopeKey
        ? refreshIssue.issue
        : null;

    return {
      status: canRead
        ? hasScopeData
          ? "ready"
          : requestStatus
        : churchId
          ? "error"
          : "loading",
      timeZone: hasScopeData ? loadedTimeZone.timeZone : null,
      isConfigured: hasScopeData && loadedTimeZone.isConfigured,
      legacyTimeZoneSuggestion: hasScopeData
        ? loadedTimeZone.legacyTimeZoneSuggestion
        : null,
      refreshIssue: currentRefreshIssue,
      refresh,
      adoptSavedTimeZone,
    };
  }, [
    adoptSavedTimeZone,
    canRead,
    churchId,
    isAuthenticated,
    loadedTimeZone,
    refresh,
    refreshIssue,
    requestState,
    scopeKey,
  ]);

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
