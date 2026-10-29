import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DBHeading, DBItem } from "../types";

/** Legacy items may lack docType; explicit non-item discriminators win. */
export const isItemDocument = (value: unknown): value is DBItem | DBHeading => {
  if (!value || typeof value !== "object") return false;
  const doc = value as Record<string, unknown>;
  return typeof doc._id === "string" && typeof doc.name === "string" && !doc._id.startsWith("_") && !doc._deleted &&
    (doc.docType === undefined || doc.docType === "item" || doc.docType === "heading") &&
    ["song", "free", "timer", "bible", "heading", "service-time"].includes(String(doc.type));
};

function getDocsKey(type: string): "allSongDocs" | "allFreeFormDocs" | "allTimerDocs" | "allBibleDocs" | "allServiceTimeDocs" | null {
  if (type === "service-time") return "allServiceTimeDocs";
  if (type === "song") return "allSongDocs";
  if (type === "free") return "allFreeFormDocs";
  if (type === "timer") return "allTimerDocs";
  if (type === "bible") return "allBibleDocs";
  return null;
}

let nextCacheSession = 0;

type AllDocsState = {
  session: number;
  changeVersion: number;
  allSongDocs: DBItem[];
  allFreeFormDocs: DBItem[];
  allTimerDocs: DBItem[];
  allBibleDocs: DBItem[];
  allServiceTimeDocs: DBItem[];
  allHeadingDocs: DBHeading[];
  isInitialized: boolean;
  error: string | null;
};

const initialState: AllDocsState = {
  session: 0,
  changeVersion: 0,
  allSongDocs: [],
  allFreeFormDocs: [],
  allTimerDocs: [],
  allBibleDocs: [],
  allServiceTimeDocs: [],
  allHeadingDocs: [],
  isInitialized: false,
  error: null,
};

export const allDocsSlice = createSlice({
  name: "allDocs",
  initialState: () => ({ ...initialState, session: ++nextCacheSession }),
  reducers: {
    resetItemCache: (state) => ({ ...initialState, session: state.session }),
    hydrateItemCache: (state, action: PayloadAction<Array<DBItem | DBHeading>>) => {
      state.allSongDocs = [];
      state.allFreeFormDocs = [];
      state.allTimerDocs = [];
      state.allBibleDocs = [];
      state.allServiceTimeDocs = [];
      state.allHeadingDocs = [];
      for (const doc of action.payload) {
        if (doc.type === "heading") state.allHeadingDocs.push(doc as DBHeading);
        else {
          const key = getDocsKey(doc.type);
          if (key) state[key].push(doc as DBItem);
        }
      }
      state.isInitialized = true;
      state.error = null;
    },
    applyItemDocumentChange: (state, action: PayloadAction<{
      id: string;
      doc?: DBItem | DBHeading;
      deleted?: boolean;
    }>) => {
      const { id, doc, deleted } = action.payload;
      if (deleted) {
        // Tombstones need not retain their original item type.
        const cached = [state.allSongDocs, state.allFreeFormDocs, state.allTimerDocs, state.allBibleDocs, state.allServiceTimeDocs, state.allHeadingDocs]
          .some((docs) => docs.some((item) => item._id === id));
        if (!cached) return;
      } else if (!isItemDocument(doc)) return;
      state.changeVersion += 1;
      for (const key of ["allSongDocs", "allFreeFormDocs", "allTimerDocs", "allBibleDocs", "allServiceTimeDocs"] as const) {
        const index = state[key].findIndex((item) => item._id === id);
        if (!deleted && doc && getDocsKey(doc.type) === key) {
          if (index < 0) state[key].push(doc as DBItem);
          else state[key][index] = doc as DBItem;
        } else if (index >= 0) state[key].splice(index, 1);
      }
      const index = state.allHeadingDocs.findIndex((item) => item._id === id);
      if (!deleted && doc?.type === "heading") {
        if (index < 0) state.allHeadingDocs.push(doc as DBHeading);
        else state.allHeadingDocs[index] = doc as DBHeading;
      } else if (index >= 0) state.allHeadingDocs.splice(index, 1);
    },
    setItemCacheError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },

  },
});

export const {
  resetItemCache,
  hydrateItemCache,
  applyItemDocumentChange,
  setItemCacheError,
} = allDocsSlice.actions;

export default allDocsSlice.reducer;
