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
import { getStoredBoardAdminHeaders } from "../api/login";
import { GlobalInfoContext } from "../context/globalInfo";
import { getApiBasePath } from "../utils/environment";
import { MAX_INITIAL_SESSION_RETRIES } from "../constants";
import { BoardConnectionStatus } from "./useBoardData";

const BOARD_SESSION_TIMEOUT_MS = 15000;
const getRetryDelay = (attempt: number) => Math.min(30000, 5000 * 2 ** attempt);

type BoardSyncContextType = {
  db: PouchDB.Database | undefined;
  status: BoardConnectionStatus["status"];
  connectionStatus: BoardConnectionStatus;
  pullFromRemote: () => void;
  retryNow: () => void;
};

export const BoardSyncContext = createContext<BoardSyncContextType | null>(null);

export const useBoardSync = () => useContext(BoardSyncContext);

const getBoardSession = async () => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BOARD_SESSION_TIMEOUT_MS);
  const bootstrapHeaders = new Headers(getStoredBoardAdminHeaders());

  try {
    const bootstrapResponse = await fetch(
      `${getApiBasePath()}api/boards/admin/bootstrap`,
      {
        headers: bootstrapHeaders,
        signal: controller.signal,
      },
    );
    if (!bootstrapResponse.ok) {
      if (bootstrapResponse.status === 401) {
        throw new Error("Sign in again to open discussion boards.");
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
  const { database } = useContext(GlobalInfoContext) || {};
  const [db, setDb] = useState<PouchDB.Database | undefined>(undefined);
  const [retryNonce, setRetryNonce] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<BoardConnectionStatus>({
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
    if (!database) return;
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
        console.error("Board sync setup failed:", error);
        setDb(undefined);
        await closeConnections();
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
  }, [database, retryNonce, clearRetryTimeout, closeConnections]);

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
