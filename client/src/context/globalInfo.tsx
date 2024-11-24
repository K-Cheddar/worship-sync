import { createContext, useEffect, useState } from "react";
import PouchDB from "pouchdb";
import { Cloudinary } from "@cloudinary/url-gen";

type GlobalInfoContextType = {
  db: PouchDB.Database | undefined;
  cloud: Cloudinary | undefined;
};

export const GlobalInfoContext = createContext<GlobalInfoContextType | null>(
  null
);

export let globalDb: PouchDB.Database | undefined = undefined;

const GlobalInfoProvider = ({ children }: any) => {
  const [db, setDb] = useState<PouchDB.Database | undefined>(undefined);
  const [cloud, setCloud] = useState<Cloudinary | undefined>(undefined);

  useEffect(() => {
    const setupDb = async () => {
      const database = "demo";
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
        });
    };

    setupDb();
  }, []);

  useEffect(() => {
    const setupCloud = () => {
      const cloud = new Cloudinary({
        cloud: {
          cloudName: "portable-media",
          apiKey: process.env.REACT_APP_CLOUDINARY_KEY,
          apiSecret: process.env.REACT_APP_CLOUDINARY_SECRET,
        },
      });
      setCloud(cloud);
    };

    setupCloud();
  }, []);

  return (
    <GlobalInfoContext.Provider value={{ db, cloud }}>
      {children}
    </GlobalInfoContext.Provider>
  );
};

export default GlobalInfoProvider;
