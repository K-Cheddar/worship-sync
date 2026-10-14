import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { RestreamMessage, RestreamSession } from "../types";
import { getRestreamMessages, getRestreamSessionStatus } from "./api";
import { GlobalInfoContext } from "../context/globalInfo";
import {
  connectAuthenticatedSse,
  type AuthenticatedSseFailure,
} from "../utils/authenticatedSse";

export type RestreamFeedState = "pending" | "empty" | "has_messages";
export type RestreamStreamState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "unavailable";
export type RestreamStreamFailure = AuthenticatedSseFailure["kind"] | null;

export type UseRestreamSessionResult = {
  session: RestreamSession | null;
  messages: RestreamMessage[];
  isLoading: boolean;
  error: string;
  bestEffortOnly: boolean;
  oauthConfigured: boolean;
  /** Browser reports offline; live updates may stall until reconnected */
  isOffline: boolean;
  streamState: RestreamStreamState;
  streamFailure: RestreamStreamFailure;
  /** Distinct feed outcome after load when Restream is enabled */
  feedState: RestreamFeedState;
  reload: () => Promise<void>;
};

export const useRestreamSession = (
  churchId: string,
): UseRestreamSessionResult => {
  const authContext = useContext(GlobalInfoContext);
  const sessionIdentity = [
    authContext?.loginState || "",
    authContext?.sessionKind || "",
    authContext?.userId || "",
    authContext?.device?.deviceId || "",
    authContext?.access || "",
  ].join("\u001f");
  const [session, setSession] = useState<RestreamSession | null>(null);
  const [messages, setMessages] = useState<RestreamMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [bestEffortOnly, setBestEffortOnly] = useState(true);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const [streamState, setStreamState] = useState<RestreamStreamState>(
    "connecting",
  );
  const [streamFailure, setStreamFailure] =
    useState<RestreamStreamFailure>(null);
  const mountedRef = useRef(true);
  const hasLoadedOnceRef = useRef(false);
  const loadInFlightRef = useRef(false);
  const loadQueuedRef = useRef(false);
  const churchIdRef = useRef(churchId);
  const sessionIdentityRef = useRef(sessionIdentity);
  const loadLatestRef = useRef<() => Promise<void>>(async () => {});

  churchIdRef.current = churchId;
  sessionIdentityRef.current = sessionIdentity;

  const feedState = useMemo((): RestreamFeedState => {
    if (!churchId || isLoading) return "pending";
    if (error) return "pending";
    if (!session?.enabled) return "pending";
    return messages.length > 0 ? "has_messages" : "empty";
  }, [churchId, error, isLoading, messages.length, session?.enabled]);

  const load = useCallback(async () => {
    const requestedChurchId = churchId;
    const requestedSessionIdentity = sessionIdentity;
    if (!requestedChurchId) {
      setSession(null);
      setMessages([]);
      setIsLoading(false);
      hasLoadedOnceRef.current = false;
      return;
    }
    if (loadInFlightRef.current) {
      loadQueuedRef.current = true;
      return;
    }
    loadInFlightRef.current = true;
    loadQueuedRef.current = false;

    if (!hasLoadedOnceRef.current) {
      setIsLoading(true);
    }
    try {
      const [statusResponse, messagesResponse] = await Promise.all([
        getRestreamSessionStatus(requestedChurchId),
        getRestreamMessages(requestedChurchId),
      ]);
      // Reject responses from an earlier church or signed-in identity.
      if (
        !mountedRef.current ||
        churchIdRef.current !== requestedChurchId ||
        sessionIdentityRef.current !== requestedSessionIdentity
      ) {
        return;
      }
      setSession(statusResponse.session);
      setMessages(messagesResponse.messages);
      setBestEffortOnly(statusResponse.bestEffortOnly);
      setOauthConfigured(statusResponse.oauthConfigured);
      setError("");
      hasLoadedOnceRef.current = true;
    } catch (nextError) {
      if (
        !mountedRef.current ||
        churchIdRef.current !== requestedChurchId ||
        sessionIdentityRef.current !== requestedSessionIdentity
      ) {
        return;
      }
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not load the Restream session.",
      );
    } finally {
      loadInFlightRef.current = false;
      if (
        mountedRef.current &&
        churchIdRef.current === requestedChurchId &&
        sessionIdentityRef.current === requestedSessionIdentity
      ) {
        setIsLoading(false);
      }
      // Always re-enter through the latest load so a queued refresh cannot
      // reuse a stale churchId closure from the request that just finished.
      if (mountedRef.current && loadQueuedRef.current) {
        loadQueuedRef.current = false;
        queueMicrotask(() => {
          void loadLatestRef.current();
        });
      }
    }
  }, [churchId, sessionIdentity]);

  useEffect(() => {
    loadLatestRef.current = load;
  }, [load]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    hasLoadedOnceRef.current = false;
    setIsLoading(Boolean(churchId));
    setSession(null);
    setMessages([]);
    setError("");
    setBestEffortOnly(true);
    setOauthConfigured(false);
    setStreamState(churchId ? "connecting" : "unavailable");
    setStreamFailure(null);
  }, [churchId, sessionIdentity]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!churchId) return;
    let disposed = false;
    const close = connectAuthenticatedSse(
      `api/churches/${encodeURIComponent(churchId)}/restream/stream`,
      {
        onOpen: () => {
          if (disposed) return;
          setStreamState("connected");
          setStreamFailure(null);
          // A snapshot after every open closes the gap between the last
          // delivered event and this connection, including after reconnects.
          void loadLatestRef.current();
        },
        onError: (failure) => {
          if (disposed) return;
          setStreamFailure(failure.kind);
          if (
            failure.kind === "authentication" ||
            failure.kind === "permission" ||
            (failure.kind === "http" && !failure.retryable) ||
            failure.kind === "invalid-response"
          ) {
            setStreamState("unavailable");
            return;
          }
          setStreamState("disconnected");
        },
        onMessage: (rawData) => {
          if (disposed) return;
          try {
            const data = JSON.parse(rawData) as { type?: string };
            if (
              data.type === "message-created" ||
              data.type === "message-updated" ||
              data.type === "session-reset" ||
              data.type === "status-updated"
            ) {
              void loadLatestRef.current();
            }
          } catch {
            void loadLatestRef.current();
          }
        },
      },
    );

    const fallbackInterval = setInterval(() => {
      void loadLatestRef.current();
    }, 60000);

    return () => {
      disposed = true;
      close();
      clearInterval(fallbackInterval);
    };
  }, [churchId, sessionIdentity]);

  return {
    session,
    messages,
    isLoading,
    error,
    bestEffortOnly,
    oauthConfigured,
    isOffline,
    streamState,
    streamFailure,
    feedState,
    reload: load,
  };
};
