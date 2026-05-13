import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RestreamMessage, RestreamSession } from "../types";
import { getRestreamMessages, getRestreamSessionStatus } from "./api";
import { getApiBasePath } from "../utils/environment";

export type RestreamFeedState = "pending" | "empty" | "has_messages";

export type UseRestreamSessionResult = {
  session: RestreamSession | null;
  messages: RestreamMessage[];
  isLoading: boolean;
  error: string;
  bestEffortOnly: boolean;
  oauthConfigured: boolean;
  /** Browser reports offline; live updates may stall until reconnected */
  isOffline: boolean;
  /** Distinct feed outcome after load when Restream is enabled */
  feedState: RestreamFeedState;
  reload: () => Promise<void>;
};

export const useRestreamSession = (
  churchId: string,
): UseRestreamSessionResult => {
  const [session, setSession] = useState<RestreamSession | null>(null);
  const [messages, setMessages] = useState<RestreamMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [bestEffortOnly, setBestEffortOnly] = useState(true);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const mountedRef = useRef(true);
  const hasLoadedOnceRef = useRef(false);
  const loadInFlightRef = useRef(false);

  const feedState = useMemo((): RestreamFeedState => {
    if (!churchId || isLoading) return "pending";
    if (error) return "pending";
    if (!session?.enabled) return "pending";
    return messages.length > 0 ? "has_messages" : "empty";
  }, [churchId, error, isLoading, messages.length, session?.enabled]);

  const load = useCallback(async () => {
    if (!churchId) {
      setSession(null);
      setMessages([]);
      setIsLoading(false);
      hasLoadedOnceRef.current = false;
      return;
    }
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;

    if (!hasLoadedOnceRef.current) {
      setIsLoading(true);
    }
    try {
      const [statusResponse, messagesResponse] = await Promise.all([
        getRestreamSessionStatus(churchId),
        getRestreamMessages(churchId),
      ]);
      if (!mountedRef.current) return;
      setSession(statusResponse.session);
      setMessages(messagesResponse.messages);
      setBestEffortOnly(statusResponse.bestEffortOnly);
      setOauthConfigured(statusResponse.oauthConfigured);
      setError("");
      hasLoadedOnceRef.current = true;
    } catch (nextError) {
      if (!mountedRef.current) return;
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not load the Restream session.",
      );
    } finally {
      loadInFlightRef.current = false;
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [churchId]);

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
  }, [churchId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!churchId) return;
    const source = new EventSource(
      `${getApiBasePath()}api/churches/${encodeURIComponent(churchId)}/restream/stream`,
      { withCredentials: true },
    );

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type?: string };
        if (
          data.type === "message-created" ||
          data.type === "message-updated" ||
          data.type === "session-reset" ||
          data.type === "status-updated"
        ) {
          void load();
        }
      } catch {
        void load();
      }
    };

    const fallbackInterval = setInterval(() => {
      void load();
    }, 60000);

    return () => {
      source.close();
      clearInterval(fallbackInterval);
    };
  }, [churchId, load]);

  return {
    session,
    messages,
    isLoading,
    error,
    bestEffortOnly,
    oauthConfigured,
    isOffline,
    feedState,
    reload: load,
  };
};
