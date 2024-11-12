import { createContext, useEffect, useState } from "react";
import PouchDB from "pouchdb";

type RemoteDbContextType = {
  db: PouchDB.Database | null;
  setDb: Function;
};

export const RemoteDbContext = createContext<RemoteDbContextType | null>(null);

const RemoteDbProvider = ({ children }: any) => {
  const [db, setDb] = useState<PouchDB.Database | null>(null);

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
          console.log("Replication completed");
        });
    };

    setupDb();
  }, []);

  return (
    <RemoteDbContext.Provider value={{ db, setDb }}>
      {children}
    </RemoteDbContext.Provider>
  );
};

export default RemoteDbProvider;
