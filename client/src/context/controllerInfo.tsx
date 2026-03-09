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
import { Cloudinary } from "@cloudinary/url-gen";
import { GlobalInfoContext } from "./globalInfo";
import { useLocation } from "react-router-dom";
import { useDispatch } from "../hooks";
import { backoff } from "../utils/generalUtils";
import { getApiBasePath } from "../utils/environment";
import { MAX_INITIAL_SESSION_RETRIES, MAX_REPLICATION_AUTH_RETRIES } from "../constants";

export type ConnectionStatus = {
  status: "connecting" | "retrying" | "failed" | "connected";
  retryCount: number;
};

type ControllerInfoContextType = {
  db: PouchDB.Database | undefined;
  bibleDb: PouchDB.Database | undefined;
  cloud: Cloudinary;
  updater: EventTarget;
  isMobile: boolean;
  isPhone: boolean;
  dbProgress: number;
  bibleDbProgress: number;
  connectionStatus: ConnectionStatus;
  setIsMobile: (val: boolean) => void;
  setIsPhone: (val: boolean) => void;
  logout: () => Promise<void>;
  login: ({
    username,
    password,
  }: {
    username: string;
    password: string;
  }) => Promise<void>;
  pullFromRemote: () => void;
};

export const ControllerInfoContext =
  createContext<ControllerInfoContextType | null>(null);

export let globalDb: PouchDB.Database | undefined = undefined;
export let globalBibleDb: PouchDB.Database | undefined = undefined;
export let globalBroadcastRef: BroadcastChannel | undefined = undefined;

export const updateGlobalBroadcast = (database: string) => {
  if (globalBroadcastRef) {
    globalBroadcastRef.close();
  }
  globalBroadcastRef = new BroadcastChannel(`worship-sync-${database}-updates`);
};

export type CouchResponse = {
  success: boolean;
  message: string;
};

const cloud = new Cloudinary({
  cloud: {
    cloudName: "portable-media",
    apiKey: import.meta.env.VITE_CLOUDINARY_KEY,
    apiSecret: import.meta.env.VITE_CLOUDINARY_SECRET,
  },
});

let pendingMax = 0;

let syncTimeout: NodeJS.Timeout | null = null;

const ControllerInfoProvider = ({ children }: any) => {
  const [db, setDb] = useState<PouchDB.Database | undefined>(undefined);
  const [bibleDb, setBibleDb] = useState<PouchDB.Database | undefined>(
    undefined
  );
  const [dbProgress, setDbProgress] = useState(0);
  const [bibleDbProgress, setBibleDbProgress] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  const [isDbSetup, setIsDbSetup] = useState(false);
  const [isBibleDbSetup, setIsBibleDbSetup] = useState(false);
  const [hasCouchSession, setHasCouchSession] = useState(false);
  const [hasCheckedSession, setHasCheckedSession] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    status: "connecting",
    retryCount: 0,
  });

  const location = useLocation();
  const dispatch = useDispatch();

  const { database, loginState, logout, setLoginState, login } =
    useContext(GlobalInfoContext) || {};

  // Update broadcast channel when database changes
  useEffect(() => {
    if (database) {
      updateGlobalBroadcast(database);
    }
  }, [database]);

  const updater = useRef(new EventTarget());
  const syncRef = useRef<any>(null);
  const syncBatchSizeRef = useRef(40);
  const remoteDbRef = useRef<PouchDB.Database | null>(null);
  const syncRetryRef = useRef(0);
  const replicateRetryRef = useRef(0);
  const replicateRef = useRef<any>(null);
  const bibleSyncRef = useRef<any>(null);
  const bibleSyncRetryRef = useRef(0);
  const bibleReplicateRetryRef = useRef(0);
  const bibleReplicateRef = useRef<any>(null);
  const initialSessionRetryRef = useRef(0);

  const getCouchSession = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const response = await fetch(
        `${getApiBasePath()}api/getDbSession`,
        {
          credentials: "include",
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      // Check if response is actually JSON
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        console.warn("getCouchSession: Response is not JSON, skipping");
        return false;
      }

      const data = await response.json();
      setHasCouchSession(data.success);
      return data.success;
    } catch (error: any) {
      clearTimeout(timeoutId);
      // Network error (server down, no internet, timeout)
      if (error.name === "AbortError" || error.name === "TypeError") {
        console.error("getCouchSession: Network error or timeout:", error);
      } else {
        console.error("getCouchSession: Error fetching session:", error);
      }
      return false;
    }
  }, []);

  const syncDb = useCallback(
    async (localDb: PouchDB.Database, remoteDb: PouchDB.Database) => {
      syncRef.current?.cancel();

      const batchSize = syncBatchSizeRef.current;
      syncRef.current = localDb
        .sync(remoteDb, {
          retry: true,
          live: true,
          batch_size: batchSize,
          batches_limit: 5,
        })
        .on("change", (event) => {
          if (event.direction === "push") {
            console.log("updating from local", event);
          }
          if (event.direction === "pull") {
            console.log("updating from remote", event);
            updater.current.dispatchEvent(
              new CustomEvent("update", { detail: event.change.docs })
            );
          }
        })
        .on("error", async (error: any) => {
          if (error.status === 413) {
            syncBatchSizeRef.current = Math.max(10, syncBatchSizeRef.current - 5);
            console.warn(
              "Sync push 413 (Content Too Large), retrying with smaller batch_size:",
              syncBatchSizeRef.current
            );
            syncDb(localDb, remoteDb);
            return;
          }
          if (error.status === 401 || error.status === 403) {
            setConnectionStatus({ status: "retrying", retryCount: syncRetryRef.current + 1 });
            setHasCouchSession(false);
            const success = await getCouchSession();
            if (!success) {
              syncRetryRef.current++;
              if (syncRetryRef.current > MAX_REPLICATION_AUTH_RETRIES) {
                setConnectionStatus({ status: "failed", retryCount: syncRetryRef.current });
                return;
              }
              await backoff(syncRetryRef.current);
            } else {
              syncRetryRef.current = 0;
            }
            syncDb(localDb, remoteDb);
          }
        });
    },
    [getCouchSession]
  );

  const pullFromRemote = useCallback(() => {
    const remote = remoteDbRef.current;
    if (!db || !remote || loginState !== "success") return;
    remote
      .replicate.to(db, { retry: false })
      .on("change", (info: any) => {
        if (info.docs?.length) {
          updater.current.dispatchEvent(
            new CustomEvent("update", { detail: info.docs })
          );
        }
      });
  }, [db, loginState]);

  const bibleSyncDb = useCallback(
    async (localDb: PouchDB.Database, remoteDb: PouchDB.Database) => {
      bibleSyncRef.current?.cancel();

      bibleSyncRef.current = localDb
        .changes({ since: "now", live: true })
        .on("change", () => {
          if (syncTimeout) clearTimeout(syncTimeout);
          syncTimeout = setTimeout(() => {
            localDb.sync(remoteDb, { retry: true });
          }, 10000); // Wait 10 second after last change
        })
        .on("error", async (error: any) => {
          if (error.status === 401 || error.status === 403) {
            setConnectionStatus({ status: "retrying", retryCount: bibleSyncRetryRef.current + 1 });
            setHasCouchSession(false);
            const success = await getCouchSession();
            if (!success) {
              bibleSyncRetryRef.current++;
              if (bibleSyncRetryRef.current > MAX_REPLICATION_AUTH_RETRIES) {
                setConnectionStatus({ status: "failed", retryCount: bibleSyncRetryRef.current });
                return;
              }
              await backoff(bibleSyncRetryRef.current);
            } else {
              bibleSyncRetryRef.current = 0;
            }
          }
        });
    },
    [getCouchSession]
  );

  useEffect(() => {
    const attemptSession = async () => {
      if (
        (loginState === "success" || loginState === "demo") &&
        location.pathname !== "/" &&
        location.pathname !== "/login" &&
        !hasCheckedSession
      ) {
        setConnectionStatus({ status: "connecting", retryCount: 0 });
        const success = await getCouchSession();

        if (!success) {
          initialSessionRetryRef.current++;

          if (initialSessionRetryRef.current <= MAX_INITIAL_SESSION_RETRIES) {
            setConnectionStatus({
              status: "retrying",
              retryCount: initialSessionRetryRef.current,
            });
            // Start at 5 seconds (base=5000ms), grow exponentially, cap at 30 seconds
            await backoff(initialSessionRetryRef.current, 5000, 30000);
            attemptSession();
          } else {
            console.error(
              `Failed to establish session after ${MAX_INITIAL_SESSION_RETRIES} attempts. Server may be down.`
            );
            setConnectionStatus({
              status: "failed",
              retryCount: MAX_INITIAL_SESSION_RETRIES,
            });
            setHasCheckedSession(true);
          }
        } else {
          // Success! Reset retry counter and mark as checked
          initialSessionRetryRef.current = 0;
          setConnectionStatus({ status: "connected", retryCount: 0 });
          setHasCheckedSession(true);
        }
      }
    };

    attemptSession();
  }, [getCouchSession, loginState, location.pathname, hasCheckedSession]);

  // Reset retry counter when login state or database changes
  useEffect(() => {
    initialSessionRetryRef.current = 0;
    setConnectionStatus({ status: "connecting", retryCount: 0 });
  }, [loginState, database]);

  useEffect(() => {
    const setupDb = async () => {
      try {
        const dbName = `worship-sync-${database}`;

        // Wrap PouchDB initialization in try-catch to handle IndexedDB errors
        let localDb: PouchDB.Database;
        try {
          localDb = new PouchDB(dbName);
        } catch (dbError: any) {
          console.error("Error creating local PouchDB:", dbError);
          // If IndexedDB fails, try to handle it gracefully
          if (dbError.name === "IndexedDBError" || dbError.message?.includes("IndexedDB")) {
            console.error("IndexedDB error detected. This may be due to browser storage issues.");
            // Try to clear and retry once
            try {
              // Wait a bit and retry
              await new Promise(resolve => setTimeout(resolve, 1000));
              localDb = new PouchDB(dbName);
            } catch (retryError) {
              console.error("Failed to create PouchDB after retry:", retryError);
              // Set error state or show user notification
              setDbProgress(0);
              return;
            }
          } else {
            throw dbError;
          }
        }

        const remoteUrl = `${import.meta.env.VITE_COUCHDB_HOST}/${dbName}`;
        let remoteDb: PouchDB.Database;
        try {
          remoteDb = new PouchDB(remoteUrl, {
            fetch: (url, options: any) => {
              const opts = options ?? {};
              opts.credentials = "include";
              return fetch(url, opts);
            },
          });
          remoteDbRef.current = remoteDb;
        } catch (remoteError) {
          console.error("Error creating remote PouchDB:", remoteError);
          setDbProgress(0);
          return;
        }

        syncRef.current?.cancel();
        replicateRef.current?.cancel();
        pendingMax = 0;

        replicateRef.current = remoteDb.replicate
          .to(localDb, { retry: true, batch_size: 150, batches_limit: 15 })
          .on("change", (info) => {
            const pending: number = (info as any).pending; // this property exists when printing info
            pendingMax = pendingMax < pending ? pending : pendingMax;
            if (pendingMax > 0) {
              setDbProgress(Math.floor((1 - pending / pendingMax) * 100));
            } else {
              setDbProgress(100);
            }
          })
          .on("error", async (error: any) => {
            console.error("Replication error:", error);
            if (error.status === 401 || error.status === 403) {
              setHasCouchSession(false);
              replicateRef.current?.cancel();

              replicateRetryRef.current++;
              if (replicateRetryRef.current > MAX_REPLICATION_AUTH_RETRIES) {
                setConnectionStatus({
                  status: "failed",
                  retryCount: replicateRetryRef.current,
                });
                return;
              }

              setConnectionStatus({
                status: "retrying",
                retryCount: replicateRetryRef.current,
              });
              const success = await getCouchSession();
              if (!success) {
                setConnectionStatus({
                  status: "failed",
                  retryCount: replicateRetryRef.current,
                });
                return;
              }
              // Do not reset replicateRetryRef here; allow cap to stop the loop
            }
          })
          .on("complete", () => {
            setDbProgress(100);
            setDb(localDb);
            setIsDbSetup(true);
            globalDb = localDb;
            if (database) {
              updateGlobalBroadcast(database);
            }
            console.log("Replication completed");
            if (loginState === "success") {
              syncDb(localDb, remoteDb);
            }
          });
      } catch (error) {
        console.error("Error in setupDb:", error);
        setDbProgress(0);
        // Don't set isDbSetup to true on error, so it can retry
      }
    };

    if (
      (loginState === "success" || loginState === "demo") &&
      location.pathname !== "/" &&
      location.pathname !== "/login" &&
      !isDbSetup &&
      hasCouchSession
    ) {
      setupDb();
    }
  }, [
    loginState,
    database,
    location.pathname,
    isDbSetup,
    hasCouchSession,
    syncDb,
    getCouchSession,
  ]);

  useEffect(() => {
    const setupBibleDb = async () => {
      const dbName = "worship-sync-bibles";
      const localDb = new PouchDB(dbName);
      const remoteUrl = `${import.meta.env.VITE_COUCHDB_HOST}/${dbName}`;
      const remoteDb = new PouchDB(remoteUrl, {
        fetch: (url, options: any) => {
          options.credentials = "include";
          return fetch(url, options);
        },
      });

      bibleSyncRef.current?.cancel();
      bibleReplicateRef.current?.cancel();
      pendingMax = 0;

      bibleReplicateRef.current = remoteDb.replicate
        .to(localDb, { retry: true, batch_size: 1000, batches_limit: 25 })
        .on("change", (info) => {
          const pending: number = (info as any).pending; // this property exists when printing info
          pendingMax = pendingMax < pending ? pending : pendingMax;
          if (pendingMax > 0) {
            setBibleDbProgress(Math.floor((1 - pending / pendingMax) * 100));
          } else {
            setBibleDbProgress(100);
          }
        })
        .on("error", async (error: any) => {
          if (error.status === 401 || error.status === 403) {
            setHasCouchSession(false);
            bibleReplicateRef.current?.cancel();

            bibleReplicateRetryRef.current++;
            if (bibleReplicateRetryRef.current > MAX_REPLICATION_AUTH_RETRIES) {
              setConnectionStatus({
                status: "failed",
                retryCount: bibleReplicateRetryRef.current,
              });
              return;
            }

            setConnectionStatus({
              status: "retrying",
              retryCount: bibleReplicateRetryRef.current,
            });
            const success = await getCouchSession();
            if (!success) {
              setConnectionStatus({
                status: "failed",
                retryCount: bibleReplicateRetryRef.current,
              });
              return;
            }
            // Do not reset bibleReplicateRetryRef here; allow cap to stop the loop
          }
        })
        .on("complete", () => {
          setBibleDbProgress(100);
          setBibleDb(localDb);
          setIsBibleDbSetup(true);
          globalBibleDb = localDb;
          console.log("Bible Replication completed");
          if (loginState === "success") {
            bibleSyncDb(localDb, remoteDb);
          }
        });
    };

    if (
      (loginState === "success" || loginState === "demo") &&
      location.pathname !== "/" &&
      location.pathname !== "/login" &&
      !isBibleDbSetup &&
      isDbSetup &&
      hasCouchSession
    ) {
      setupBibleDb();
    }
  }, [
    loginState,
    location.pathname,
    isBibleDbSetup,
    isDbSetup,
    hasCouchSession,
    bibleSyncDb,
    getCouchSession,
  ]);

  const _logout = useCallback(async () => {
    setLoginState?.("loading");
    await syncRef.current?.cancel();
    await bibleSyncRef.current?.cancel();
    await replicateRef.current?.cancel();
    await bibleReplicateRef.current?.cancel();
    remoteDbRef.current = null;
    globalDb = undefined;
    setDb(undefined);
    setDbProgress(0);
    setIsDbSetup(false);
    setIsBibleDbSetup(false);
    setBibleDbProgress(0);
    pendingMax = 0;

    if (db) {
      db.destroy()
        .catch((e) => {
          console.error(e);
        })
        .finally(() => {
          logout?.();
        });
    } else {
      logout?.();
    }
  }, [db, logout, setLoginState]);

  const _login = useCallback(async ({
    username,
    password,
  }: {
    username: string;
    password: string;
  }) => {
    if (syncTimeout) {
      clearTimeout(syncTimeout);
      syncTimeout = null;
    }
    syncRef.current?.cancel();
    bibleSyncRef.current?.cancel();
    replicateRef.current?.cancel();
    bibleReplicateRef.current?.cancel();
    remoteDbRef.current = null;
    globalDb = undefined;
    setDb(undefined);
    setDbProgress(0);
    setIsDbSetup(false);
    setBibleDb(undefined);
    setBibleDbProgress(0);
    setIsBibleDbSetup(false);
    pendingMax = 0;
    dispatch({ type: "RESET_INITIALIZATION" });

    if (db) {
      db.destroy()
        .catch((e) => {
          console.error(e);
        })
        .finally(() => {
          login?.({ username, password });
        });
    } else {
      login?.({ username, password });
    }
  }, [db, login, dispatch]);

  useEffect(() => {
    return () => {
      if (syncTimeout) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
      }
      syncRef.current?.cancel();
      bibleSyncRef.current?.cancel();
      replicateRef.current?.cancel();
      bibleReplicateRef.current?.cancel();
      remoteDbRef.current = null;
    };
  }, []);

  const value = useMemo(
    () => ({
      db,
      cloud,
      updater: updater.current,
      bibleDb,
      bibleDbProgress,
      logout: _logout,
      isMobile,
      setIsMobile,
      isPhone,
      setIsPhone,
      dbProgress,
      connectionStatus,
      login: _login,
      pullFromRemote,
    }),
    [
      db,
      bibleDb,
      bibleDbProgress,
      dbProgress,
      isMobile,
      isPhone,
      connectionStatus,
      _logout,
      _login,
      pullFromRemote,
    ]
  );

  return (
    <ControllerInfoContext.Provider value={value}>
      {children}
    </ControllerInfoContext.Provider>
  );
};

export default ControllerInfoProvider;
