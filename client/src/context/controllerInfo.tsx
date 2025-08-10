import { createContext, useContext, useEffect, useRef, useState } from "react";

import PouchDB from "pouchdb";
import { Cloudinary } from "@cloudinary/url-gen";
import { GlobalInfoContext } from "./globalInfo";
import { useLocation } from "react-router-dom";
import { getDbBasePath } from "../utils/serverUtils";

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
    undefined,
  );
  const [dbProgress, setDbProgress] = useState(0);
  const [bibleDbProgress, setBibleDbProgress] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  const [isDbSetup, setIsDbSetup] = useState(false);
  const [isBibleDbSetup, setIsBibleDbSetup] = useState(false);

  const location = useLocation();

  const { database, loginState, logout, setLoginState, login } =
    useContext(GlobalInfoContext) || {};

  const updater = useRef(new EventTarget());
  const syncRef = useRef<any>();
  const bibleSyncRef = useRef<any>();

  useEffect(() => {
    const setupDb = async() => {
      const dbName = `worship-sync-${database}`;
      const localDb = new PouchDB(dbName);
      const remoteUrl = `${getDbBasePath()}db/${dbName}`;
      const remoteDb = new PouchDB(remoteUrl);

      if (syncRef.current) {
        syncRef.current.cancel();
      }

      remoteDb.replicate
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
        .on("complete", () => {
          setDbProgress(100);
          setDb(localDb);
          setIsDbSetup(true);
          globalDb = localDb;
          console.log("Replication completed");
          if (loginState === "success") {
            syncRef.current = localDb
              .sync(remoteDb, { retry: true, live: true })
              .on("change", (event) => {
                if (event.direction === "push") {
                  console.log("updating from local", event);
                }
                if (event.direction === "pull") {
                  console.log("updating from remote", event);
                  updater.current.dispatchEvent(
                    new CustomEvent("update", { detail: event.change.docs }),
                  );
                }
              });
          }
        });
    };

    if (
      (loginState === "success" || loginState === "demo") &&
      location.pathname !== "/" &&
      location.pathname !== "/login" &&
      !isDbSetup
    ) {
      setupDb();
    }
  }, [loginState, database, location.pathname, isDbSetup]);

  useEffect(() => {
    const setupBibleDb = async() => {
      const dbName = "worship-sync-bibles";
      const localDb = new PouchDB(dbName);
      const remoteUrl = `${getDbBasePath()}db/${dbName}`;
      const remoteDb = new PouchDB(remoteUrl);

      if (bibleSyncRef.current) {
        bibleSyncRef.current.cancel();
      }

      remoteDb.replicate
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
        .on("complete", () => {
          setBibleDbProgress(100);
          setBibleDb(localDb);
          setIsBibleDbSetup(true);
          globalBibleDb = localDb;
          console.log("Bible Replication completed");
          if (loginState === "success") {
            bibleSyncRef.current = localDb
              .changes({ since: "now", live: true })
              .on("change", () => {
                if (syncTimeout) clearTimeout(syncTimeout);
                syncTimeout = setTimeout(() => {
                  localDb.sync(remoteDb, { retry: true });
                }, 10000); // Wait 10 second after last change
              });
          }
        });
    };

    if (
      (loginState === "success" || loginState === "demo") &&
      location.pathname !== "/" &&
      location.pathname !== "/login" &&
      !isBibleDbSetup &&
      isDbSetup
    ) {
      setupBibleDb();
    }
  }, [loginState, location.pathname, isBibleDbSetup, isDbSetup]);

  const _logout = async() => {
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

  const _login = async({
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
