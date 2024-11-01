import { createContext, useEffect, useState } from "react";
import PouchDB from "pouchdb";
import getBibles, { bibleVersions, checkBibles } from "../utils/getBibles";

type BibleDbContextType = {
  db: PouchDB.Database | null;
  setDb: Function;
};

export const BibleDbContext = createContext<BibleDbContextType | null>(null);

const BibleDbProvider = ({ children }: any) => {
  const [db, setDb] = useState<PouchDB.Database | null>(null);

  useEffect(() => {
    const setupDb = async () => {
      const _db = new PouchDB("bibles");

      let bibles = await checkBibles(_db);

      if (bibles.some((e) => e === false)) {
        await getBibles(_db);
      }

      setDb(_db);
    };

    setupDb();
  }, []);

  return (
    <BibleDbContext.Provider value={{ db, setDb }}>
      {children}
    </BibleDbContext.Provider>
  );
};

export default BibleDbProvider;
