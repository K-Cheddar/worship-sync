import { createContext, useContext, useEffect, useRef, useState } from "react";

import PouchDB from "pouchdb";
import { Cloudinary } from "@cloudinary/url-gen";
import { GlobalInfoContext } from "./globalInfo";
import getBibles, { checkBibles } from "../utils/getBibles";

type ControllerInfoContextType = {
  db: PouchDB.Database | undefined;
  bibleDb: PouchDB.Database | undefined;
  cloud: Cloudinary;
  updater: EventTarget;
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

const ControllerInfoProvider = ({ children }: any) => {
  const [db, setDb] = useState<PouchDB.Database | undefined>(undefined);
  const [bibleDb, setBibleDb] = useState<PouchDB.Database | undefined>(
    undefined
  );

  const { database, loginState } = useContext(GlobalInfoContext) || {};

  const updater = useRef(new EventTarget());
  const syncRef = useRef<any>();

  useEffect(() => {
    const setupDb = async () => {
      console.log(database, loginState);
      let remoteURL =
        process.env.REACT_APP_DATABASE_STRING + "portable-media-" + database;
      const remoteDb = new PouchDB(remoteURL);
      const localDb = new PouchDB("portable-media");

      remoteDb.replicate
        .to(localDb, { retry: true })
        .on("complete", function (info) {
          setDb(localDb);
          globalDb = localDb;
          console.log("Replication completed");
          if (loginState === "success") {
            syncRef.current = localDb
              .sync(remoteDb, { retry: true, live: true })
              .on("change", (event) => {
                if (event.direction === "push") {
                  console.log("updating from local");
                }
                if (event.direction === "pull") {
                  console.log("updating from remote");
                  updater.current.dispatchEvent(new Event("update"));
                }
              });
          }
        });
    };

    if (loginState === "success" || loginState === "idle") {
      setupDb();
    }
  }, [loginState, database]);

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

  return (
    <ControllerInfoContext.Provider
      value={{
        db,
        cloud,
        updater: updater.current,
        bibleDb,
      }}
    >
      {children}
    </ControllerInfoContext.Provider>
  );
};

export default ControllerInfoProvider;
