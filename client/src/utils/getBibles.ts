import { getBibles as getBiblesApi } from "../api/getBibles";

export const bibleVersions = [
  { value: "asv", label: "American Standard Version" },
  { value: "esv", label: "English Standard Version" },
  { value: "kjv", label: "King James Version" },
  { value: "niv", label: "New International Version" },
  { value: "nkjv", label: "New King James Version" },
  { value: "nlt", label: "New Living Translation" },
  { value: "amp", label: "Amplified Bible (External)" },
  { value: "ceb", label: "Common English Bible (External)" },
  { value: "cev", label: "Contemporary English Version (External)" },
  { value: "erv", label: "Easy to Read Version (External)" },
  { value: "gw", label: "God's Word (External)" },
  { value: "nasb", label: "New American Standard Bible (External)" },
  { value: "NCV", label: "New Century Version (External)" },
];

export const internalBibleVersions = [
  { value: "asv", label: "American Standard Version" },
  { value: "esv", label: "English Standard Version" },
  { value: "kjv", label: "King James Version" },
  { value: "niv", label: "New International Version" },
  { value: "nkjv", label: "New King James Version" },
  { value: "nlt", label: "New Living Translation" },
];

const getBibles = (db: PouchDB.Database): Promise<boolean[]> => {
  return Promise.all(
    internalBibleVersions.map(async (version) => {
      try {
        const books = await getBiblesApi({ version: version.value });
        db.put({ _id: version.value, ...books });
        return true;
      } catch (error) {
        return false;
      }
    })
  );
};

export const checkBibles = (db: PouchDB.Database) => {
  return Promise.all(
    internalBibleVersions.map(async (version) => {
      try {
        const response = await db.get(version.value);
        return response;
      } catch (error) {
        return false;
      }
    })
  );
};

export default getBibles;
