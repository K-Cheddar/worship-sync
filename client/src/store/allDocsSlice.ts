import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DBItem } from "../types";

function getDocsKey(type: string): keyof AllDocsState | null {
  if (type === "song") return "allSongDocs";
  if (type === "free") return "allFreeFormDocs";
  if (type === "timer") return "allTimerDocs";
  if (type === "bible") return "allBibleDocs";
  return null;
}

type AllDocsState = {
  allSongDocs: DBItem[];
  allFreeFormDocs: DBItem[];
  allTimerDocs: DBItem[];
  allBibleDocs: DBItem[];
};

const initialState: AllDocsState = {
  allSongDocs: [],
  allFreeFormDocs: [],
  allTimerDocs: [],
  allBibleDocs: [],
};

export const allDocsSlice = createSlice({
  name: "allDocs",
  initialState,
  reducers: {
    updateAllSongDocs: (state, action: PayloadAction<DBItem[]>) => {
      state.allSongDocs = action.payload;
    },
    updateAllFreeFormDocs: (state, action: PayloadAction<DBItem[]>) => {
      state.allFreeFormDocs = action.payload;
    },
    updateAllTimerDocs: (state, action: PayloadAction<DBItem[]>) => {
      state.allTimerDocs = action.payload;
    },
    updateAllBibleDocs: (state, action: PayloadAction<DBItem[]>) => {
      state.allBibleDocs = action.payload;
    },
    upsertItemInAllDocs: (state, action: PayloadAction<DBItem>) => {
      const doc = action.payload;
      const key = getDocsKey(doc.type);
      if (!key) return;
      const arr = state[key];
      const idx = arr.findIndex((d) => d._id === doc._id);
      if (idx >= 0) {
        arr[idx] = doc;
      } else {
        state[key] = [...arr, doc];
      }
    },
    removeItemFromAllDocs: (
      state,
      action: PayloadAction<{ _id: string; type: string }>,
    ) => {
      const key = getDocsKey(action.payload.type);
      if (!key) return;
      state[key] = state[key].filter(
        (doc) => doc._id !== action.payload._id,
      );
    },
  },
});

export const {
  updateAllSongDocs,
  updateAllFreeFormDocs,
  updateAllTimerDocs,
  updateAllBibleDocs,
  upsertItemInAllDocs,
  removeItemFromAllDocs,
} = allDocsSlice.actions;

export default allDocsSlice.reducer;
