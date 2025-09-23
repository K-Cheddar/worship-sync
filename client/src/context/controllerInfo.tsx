import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import PouchDB from "pouchdb";
import { Cloudinary } from "@cloudinary/url-gen";
import { GlobalInfoContext } from "./globalInfo";
import { useLocation } from "react-router-dom";
import { useDispatch } from "../hooks";
import { backoff } from "../utils/generalUtils";

type ControllerInfoContextType = {
  db: PouchDB.Database | undefined;
  bibleDb: PouchDB.Database | undefined;
  cloud: Cloudinary;
  updater: EventTarget;
  isMobile: boolean;
  isPhone: boolean;
  dbProgress: number;
  bibleDbProgress: number;
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
    apiKey: process.env.REACT_APP_CLOUDINARY_KEY,
    apiSecret: process.env.REACT_APP_CLOUDINARY_SECRET,
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
  const syncRef = useRef<any>();
  const syncRetryRef = useRef(0);
  const replicateRetryRef = useRef(0);
  const replicateRef = useRef<any>();
  const bibleSyncRef = useRef<any>();
  const bibleSyncRetryRef = useRef(0);
  const bibleReplicateRetryRef = useRef(0);
  const bibleReplicateRef = useRef<any>();

  const getCouchSession = useCallback(async () => {
    const response = await fetch(
      `${process.env.REACT_APP_API_BASE_PATH}api/getDbSession`,
      {
        credentials: "include",
      }
    );
    const data = await response.json();
    setHasCouchSession(data.success);
    return data.success;
  }, []);

  const syncDb = useCallback(
    async (localDb: PouchDB.Database, remoteDb: PouchDB.Database) => {
      syncRef.current?.cancel();

      syncRef.current = localDb
        .sync(remoteDb, { retry: true, live: true })
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
          if (error.status === 401 || error.status === 403) {
            setHasCouchSession(false);
            const success = await getCouchSession();
            if (!success) {
              syncRetryRef.current++;
              if (syncRetryRef.current > 3) {
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
            setHasCouchSession(false);
            const success = await getCouchSession();
            if (!success) {
              bibleSyncRetryRef.current++;
              if (bibleSyncRetryRef.current > 3) {
                return;
              }
              await backoff(bibleSyncRetryRef.current);
            } else {
              bibleSyncRetryRef.current = 0;
            }
            bibleSyncDb(localDb, remoteDb);
          }
        });
    },
    [getCouchSession]
  );

  useEffect(() => {
    if (
      (loginState === "success" || loginState === "demo") &&
      location.pathname !== "/" &&
      location.pathname !== "/login" &&
      !hasCheckedSession
    ) {
      getCouchSession();
      setHasCheckedSession(true);
    }
  }, [getCouchSession, loginState, location.pathname, hasCheckedSession]);

  useEffect(() => {
    const setupDb = async () => {
      const dbName = `worship-sync-${database}`;
      const localDb = new PouchDB(dbName);
      const remoteUrl = `${process.env.REACT_APP_COUCHDB_HOST}/${dbName}`;
      const remoteDb = new PouchDB(remoteUrl, {
        fetch: (url, options: any) => {
          options.credentials = "include";
          return fetch(url, options);
        },
      });

      syncRef.current?.cancel();
      replicateRef.current?.cancel();

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
          if (error.status === 401 || error.status === 403) {
            setHasCouchSession(false);
            replicateRef.current?.cancel();

            const success = await getCouchSession();
            console.log("error", error);
            if (!success) {
              replicateRetryRef.current++;
              if (replicateRetryRef.current > 3) {
                window.location.reload();
                return;
              }
              await backoff(replicateRetryRef.current);
            } else {
              replicateRetryRef.current = 0;
            }
            setupDb();
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
      const remoteUrl = `${process.env.REACT_APP_COUCHDB_HOST}/${dbName}`;
      const remoteDb = new PouchDB(remoteUrl, {
        fetch: (url, options: any) => {
          options.credentials = "include";
          return fetch(url, options);
        },
      });

      bibleSyncRef.current?.cancel();
      bibleReplicateRef.current?.cancel();

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
            console.log("error", error);
            bibleReplicateRef.current?.cancel();

            const success = await getCouchSession();
            if (!success) {
              bibleReplicateRetryRef.current++;
              if (bibleReplicateRetryRef.current > 3) {
                window.location.reload();
                return;
              }
              await backoff(bibleReplicateRetryRef.current);
              setupBibleDb();
            } else {
              bibleReplicateRetryRef.current = 0;
              setupBibleDb();
            }
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

  const _logout = async () => {
    setLoginState?.("loading");
    await syncRef.current?.cancel();
    await bibleSyncRef.current?.cancel();
    globalDb = undefined;
    setDb(undefined);
    setDbProgress(0);
    setIsDbSetup(false);

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
  };

  const _login = async ({
    username,
    password,
  }: {
    username: string;
    password: string;
  }) => {
    globalDb = undefined;
    setDb(undefined);
    setDbProgress(0);
    setIsDbSetup(false);
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
  };

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
    };
  }, []);

  return (
    <ControllerInfoContext.Provider
      value={{
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
        login: _login,
      }}
    >
      {children}
    </ControllerInfoContext.Provider>
  );
};

export default ControllerInfoProvider;
