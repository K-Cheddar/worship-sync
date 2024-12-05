import { createContext, useContext, useEffect, useRef, useState } from "react";

import PouchDB from "pouchdb";
import { Cloudinary } from "@cloudinary/url-gen";
import { GlobalInfoContext } from "./globalInfo";
import getBibles, { checkBibles } from "../utils/getBibles";
import Spinner from "../components/Spinner/Spinner";
import { useLocation } from "react-router-dom";

type ControllerInfoContextType = {
  db: PouchDB.Database | undefined;
  bibleDb: PouchDB.Database | undefined;
  cloud: Cloudinary;
  updater: EventTarget;
  isMobile: boolean;
  dbProgress: number;
  setIsMobile: (val: boolean) => void;
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

const cloud = new Cloudinary({
  cloud: {
    cloudName: "portable-media",
    apiKey: process.env.REACT_APP_CLOUDINARY_KEY,
    apiSecret: process.env.REACT_APP_CLOUDINARY_SECRET,
  },
});

let pendingMax = 0;

const ControllerInfoProvider = ({ children }: any) => {
  const [db, setDb] = useState<PouchDB.Database | undefined>(undefined);
  const [bibleDb, setBibleDb] = useState<PouchDB.Database | undefined>(
    undefined
  );
  const [dbProgress, setDbProgress] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [isDbSetup, setIsDbSetup] = useState(false);

  const location = useLocation();

  const { database, loginState, logout, setLoginState, user, login } =
    useContext(GlobalInfoContext) || {};

  const updater = useRef(new EventTarget());
  const syncRef = useRef<any>();

  useEffect(() => {
    const setupDb = async () => {
      let remoteURL =
        process.env.REACT_APP_DATABASE_STRING + "portable-media-" + database;
      const remoteDb = new PouchDB(remoteURL);
      const localDb = new PouchDB("portable-media");

      remoteDb.replicate
        .to(localDb, { retry: true })
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
                  updater.current.dispatchEvent(new Event("update"));
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
    const setupDb = async () => {
      const _db = new PouchDB("bibles");

      let bibles = await checkBibles(_db);

      if (bibles.some((e) => e === false)) {
        await getBibles(_db);
      }

      setBibleDb(_db);
    };

    setupDb();
  }, []);

  const _logout = async () => {
    setLoginState?.("loading");
    await syncRef.current?.cancel();
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
        logout: _logout,
        isMobile,
        setIsMobile,
        dbProgress,
        login: _login,
      }}
    >
      {children}
    </ControllerInfoContext.Provider>
  );
};

export default ControllerInfoProvider;
