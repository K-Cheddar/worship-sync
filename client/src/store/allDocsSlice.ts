import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DBItem } from "../types";
import {
  attachCloudCopyToLocalImageItem,
  updateLocalImageReferenceInItem,
  type LocalImageReferencePatch,
} from "../utils/localImageAssets";

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
    attachCloudCopyToLocalImageInAllDocs: (
      state,
      action: PayloadAction<{
        itemId: string;
        assetId: string;
        mediaId: string;
        url: string;
      }>,
    ) => {
      for (const key of [
        "allSongDocs",
        "allFreeFormDocs",
        "allTimerDocs",
        "allBibleDocs",
      ] as const) {
        const index = state[key].findIndex(
          (item) => item._id === action.payload.itemId,
        );
        if (index < 0) continue;
        state[key][index] = attachCloudCopyToLocalImageItem(
          state[key][index],
          action.payload.assetId,
          { mediaId: action.payload.mediaId, url: action.payload.url },
        );
        return;
      }
    },
    updateLocalImageReferenceInAllDocs: (
      state,
      action: PayloadAction<{
        itemId: string;
        assetId: string;
        patch: LocalImageReferencePatch;
      }>,
    ) => {
      for (const key of [
        "allSongDocs",
        "allFreeFormDocs",
        "allTimerDocs",
        "allBibleDocs",
      ] as const) {
        const index = state[key].findIndex(
          (item) => item._id === action.payload.itemId,
        );
        if (index < 0) continue;
        state[key][index] = updateLocalImageReferenceInItem(
          state[key][index],
          action.payload.assetId,
          action.payload.patch,
        );
        return;
      }
    },
  },
});

export const {
  updateAllSongDocs,
  updateAllFreeFormDocs,
  updateAllTimerDocs,
  updateAllBibleDocs,
  upsertItemInAllDocs,
  attachCloudCopyToLocalImageInAllDocs,
  updateLocalImageReferenceInAllDocs,
} = allDocsSlice.actions;

export default allDocsSlice.reducer;
