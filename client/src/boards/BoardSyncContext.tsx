import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PouchDB from "pouchdb-browser";
import { BOARD_REMOTE_DB_NAME } from "./boardUtils";
import { GlobalInfoContext } from "../context/globalInfo";
import { getApiBasePath } from "../utils/environment";
import { MAX_INITIAL_SESSION_RETRIES } from "../constants";
import { BoardConnectionStatus } from "./useBoardData";
import { createBoardRequestHeaders } from "./api";
import { AUTH_SIGN_IN_AGAIN_MESSAGE } from "../utils/authUserMessages";

const BOARD_SESSION_TIMEOUT_MS = 15000;
const getRetryDelay = (attempt: number) => Math.min(30000, 5000 * 2 ** attempt);

/** Pull a human-readable line out of the varied shapes PouchDB/fetch throw
 * (PouchDB errors serialize to `{}` through console, hiding the real cause). */
export const describeBoardSyncError = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const e = error as {
      status?: number;
      name?: string;
      reason?: string;
      message?: string;
    };
    return (
      e.reason ||
      e.message ||
      e.name ||
      (typeof e.status === "number" ? `HTTP ${e.status}` : "") ||
      "Unknown error"
    );
  }
  return String(error);
};

/** True when the failure is an expired/absent session rather than a transient
 * network fault — i.e. retrying won't help until the operator signs in again. */
export const isBoardAuthError = (error: unknown): boolean => {
  if (error instanceof Error && error.message === AUTH_SIGN_IN_AGAIN_MESSAGE) {
    return true;
  }
  if (error && typeof error === "object") {
    const e = error as { status?: number; name?: string };
    return e.status === 401 || e.name === "unauthorized";
  }
  return false;
};

/** The sync provider adds "paused" (replication is intentionally not running
 * because the operator isn't signed in) on top of the shared connection states,
 * so the UI can say "waiting for sign-in" instead of a misleading "connecting". */
export type BoardSyncStatus = BoardConnectionStatus["status"] | "paused";

type BoardSyncConnectionStatus = {
  status: BoardSyncStatus;
  retryCount: number;
};

type BoardSyncContextType = {
  db: PouchDB.Database | undefined;
  status: BoardSyncStatus;
  connectionStatus: BoardSyncConnectionStatus;
  pullFromRemote: () => void;
  retryNow: () => void;
};

export const BoardSyncContext = createContext<BoardSyncContextType | null>(null);

export const useBoardSync = () => useContext(BoardSyncContext);

const getBoardSession = async () => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BOARD_SESSION_TIMEOUT_MS);
  try {
    const bootstrapResponse = await fetch(
      `${getApiBasePath()}api/boards/admin/bootstrap`,
      {
        credentials: "include",
        headers: createBoardRequestHeaders(),
        signal: controller.signal,
      },
    );
    if (!bootstrapResponse.ok) {
      if (bootstrapResponse.status === 401) {
        throw new Error(AUTH_SIGN_IN_AGAIN_MESSAGE);
      }
      throw new Error("Could not prepare discussion boards.");
    }
    const response = await fetch(`${getApiBasePath()}api/getDbSession`, {
      credentials: "include",
      signal: controller.signal,
    });
    const data = await response.json();
    if (!data.success) {
      throw new Error("Could not connect. Check your connection and sign-in.");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TypeError")
    ) {
      throw new Error("Could not connect. Check the server and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const BoardSyncProvider = ({ children }: { children: React.ReactNode }) => {
  const { database, loginState } = useContext(GlobalInfoContext) || {};
  const isAuthenticated = loginState === "success";
  const [db, setDb] = useState<PouchDB.Database | undefined>(undefined);
  const [retryNonce, setRetryNonce] = useState(0);
  const [connectionStatus, setConnectionStatus] =
    useState<BoardSyncConnectionStatus>({
      status: "connecting",
      retryCount: 0,
    });
  const syncRef = useRef<PouchDB.Replication.Sync<{}> | null>(null);
  const remoteDbRef = useRef<PouchDB.Database | null>(null);
  const localDbRef = useRef<PouchDB.Database | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const closeConnections = useCallback(async () => {
    syncRef.current?.cancel();
    syncRef.current = null;

    if (remoteDbRef.current) {
      await remoteDbRef.current.close();
      remoteDbRef.current = null;
    }

    if (localDbRef.current) {
      await localDbRef.current.close();
      localDbRef.current = null;
    }
  }, []);

  const pullFromRemote = useCallback(() => {
    const localDb = localDbRef.current;
    const remoteDb = remoteDbRef.current;
    if (!localDb || !remoteDb || !database) return;
    remoteDb.replicate.to(localDb, {
      retry: false,
      selector: { database },
    });
  }, [database]);

  const retryNow = useCallback(() => {
    clearRetryTimeout();
    retryCountRef.current = 0;
    setConnectionStatus({ status: "connecting", retryCount: 0 });
    setRetryNonce((current) => current + 1);
  }, [clearRetryTimeout]);

  useEffect(() => {
    // Still loading the church context — genuinely mid-connect.
    if (!database) {
      setConnectionStatus({ status: "connecting", retryCount: 0 });
      return;
    }
    // Board replication rides the operator's session cookie. Until they're signed
    // in, don't attempt it — a stale/absent session just 401s and loops (the
    // "Board sync setup failed: {}" spam after a session expires on refresh).
    // Surface a distinct "paused" state so the UI reads "waiting for sign-in"
    // rather than a hung "connecting". This effect re-runs when loginState flips
    // to "success" after (re-)sign-in, so sync resumes on its own.
    if (!isAuthenticated) {
      setConnectionStatus({ status: "paused", retryCount: 0 });
      return;
    }
    let cancelled = false;

    const scheduleRetry = (nextRetryCount: number) => {
      if (cancelled) return;

      if (nextRetryCount > MAX_INITIAL_SESSION_RETRIES) {
        setConnectionStatus({
          status: "failed",
          retryCount: MAX_INITIAL_SESSION_RETRIES,
        });
        return;
      }

      retryCountRef.current = nextRetryCount;
      setConnectionStatus({
        status: "retrying",
        retryCount: nextRetryCount,
      });

      clearRetryTimeout();
      retryTimeoutRef.current = setTimeout(() => {
        void setup();
      }, getRetryDelay(nextRetryCount));
    };

    const setup = async () => {
      clearRetryTimeout();
      setConnectionStatus({
        status: retryCountRef.current > 0 ? "retrying" : "connecting",
        retryCount: retryCountRef.current,
      });

      try {
        await closeConnections();
        await getBoardSession();

        if (cancelled) return;

        const localDb = new PouchDB(`${BOARD_REMOTE_DB_NAME}-${database}`);
        const remoteDb = new PouchDB(
          `${import.meta.env.VITE_COUCHDB_HOST}/${BOARD_REMOTE_DB_NAME}`,
          {
            fetch: (url, options: RequestInit = {}) =>
              fetch(url, {
                ...options,
                credentials: "include",
              }),
          },
        );

        localDbRef.current = localDb;
        remoteDbRef.current = remoteDb;

        await new Promise<void>((resolve, reject) => {
          remoteDb
            .replicate.to(localDb, {
              retry: false,
              batch_size: 100,
              batches_limit: 10,
              selector: { database },
            })
            .on("complete", () => resolve())
            .on("error", reject);
        });

        if (cancelled) return;

        syncRef.current?.cancel();
        syncRef.current = localDb
          .sync(remoteDb, {
            live: true,
            retry: true,
            batch_size: 40,
            batches_limit: 5,
            selector: { database },
          })
          .on("paused", () =>
            setConnectionStatus({ status: "connected", retryCount: 0 }),
          )
          .on("active", () =>
            setConnectionStatus({ status: "connected", retryCount: 0 }),
          )
          .on("denied", () =>
            setConnectionStatus({
              status: "failed",
              retryCount: retryCountRef.current,
            }),
          )
          .on("error", () =>
            setConnectionStatus({
              status: "retrying",
              retryCount: Math.max(retryCountRef.current, 1),
            }),
          );

        setDb(localDb);
        retryCountRef.current = 0;
        setConnectionStatus({ status: "connected", retryCount: 0 });
      } catch (error) {
        if (cancelled) return;
        setDb(undefined);
        await closeConnections();

        if (isBoardAuthError(error)) {
          // Session expired or the operator signed out. Retrying without a fresh
          // session is futile and just spams failures — pause and wait for
          // re-sign-in (loginState → "success") to re-run this effect.
          console.warn(
            "Board sync paused — sign in again to resume:",
            describeBoardSyncError(error),
          );
          retryCountRef.current = 0;
          setConnectionStatus({ status: "paused", retryCount: 0 });
          return;
        }

        console.error(
          "Board sync setup failed:",
          describeBoardSyncError(error),
        );
        scheduleRetry(retryCountRef.current + 1);
      }
    };

    setup();

    return () => {
      cancelled = true;
      clearRetryTimeout();
      void closeConnections();
      setDb(undefined);
    };
  }, [database, isAuthenticated, retryNonce, clearRetryTimeout, closeConnections]);

  const value = useMemo(
    () => ({
      db,
      status: connectionStatus.status,
      connectionStatus,
      pullFromRemote,
      retryNow,
    }),
    [db, connectionStatus, pullFromRemote, retryNow],
  );

  return (
    <BoardSyncContext.Provider value={value}>
      {children}
    </BoardSyncContext.Provider>
  );
};

export default BoardSyncProvider;
