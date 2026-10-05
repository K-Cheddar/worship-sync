import type { SongLibraryDiagnostic } from "../utils/songLibraryDiscovery";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DBItem } from "../types";
import {
  attachCloudCopyToLocalImageItem,
  updateLocalImageReferenceInItem,
  type LocalImageReferencePatch,
} from "../utils/localImageAssets";
import { normalizeSongForLibrary } from "../utils/activeItemSlides";

const normalizeLibrarySong = (song: DBItem): DBItem => normalizeSongForLibrary(
  song.docType === "song-v2-root"
    ? { ...song, slides: [], arrangements: song.arrangements.map((arrangement) => ({ ...arrangement, slides: [] })) }
    : song,
);

function getDocsKey(type: string): "allSongDocs" | "allFreeFormDocs" | "allTimerDocs" | "allBibleDocs" | null {
  if (type === "song") return "allSongDocs";
  if (type === "free") return "allFreeFormDocs";
  if (type === "timer") return "allTimerDocs";
  if (type === "bible") return "allBibleDocs";
  return null;
}

type AllDocsState = {
  songLibraryDiagnostics: SongLibraryDiagnostic[];
  allSongDocs: DBItem[];
  allFreeFormDocs: DBItem[];
  allTimerDocs: DBItem[];
  allBibleDocs: DBItem[];
};

const initialState: AllDocsState = {
  songLibraryDiagnostics: [],
  allSongDocs: [],
  allFreeFormDocs: [],
  allTimerDocs: [],
  allBibleDocs: [],
};

export const allDocsSlice = createSlice({
  name: "allDocs",
  initialState,
  reducers: {
    updateSongLibraryDiagnostics: (state, action: PayloadAction<SongLibraryDiagnostic[]>) => {
      state.songLibraryDiagnostics = action.payload;
    },
    updateAllSongDocs: (state, action: PayloadAction<DBItem[]>) => {
      state.allSongDocs = action.payload.map(normalizeLibrarySong);
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
      const doc = action.payload.type === "song"
        ? normalizeLibrarySong(action.payload)
        : action.payload;
      const key = getDocsKey(doc.type);
      if (!key) return;
      const arr = state[key];
      const idx = arr.findIndex((d) => d._id === doc._id);
      if (doc.type === "song" && doc.docType !== "song-v2-root" &&
        (arr[idx]?.docType === "song-v2-root" || state.songLibraryDiagnostics.some((diagnostic) => diagnostic.songId === doc._id))) return;
      if (idx >= 0) {
        arr[idx] = doc;
      } else {
        state[key] = [...arr, doc];
      }
    },
    upsertItemsInAllDocs: (state, action: PayloadAction<DBItem[]>) => {
      for (const inputDoc of action.payload) {
        const doc = inputDoc.type === "song"
          ? normalizeLibrarySong(inputDoc)
          : inputDoc;
        const key = getDocsKey(doc.type);
        if (!key) continue;
        const arr = state[key];
        const idx = arr.findIndex((candidate) => candidate._id === doc._id);
        if (doc.type === "song" && doc.docType !== "song-v2-root" &&
          (arr[idx]?.docType === "song-v2-root" || state.songLibraryDiagnostics.some((diagnostic) => diagnostic.songId === doc._id))) continue;
        if (idx >= 0) arr[idx] = doc;
        else state[key] = [...arr, doc];
      }
    },
    removeItemFromAllDocs: (
      state,
      action: PayloadAction<{ _id: string; type: string }>,
    ) => {
      const key = getDocsKey(action.payload.type);
      if (!key) return;
      state[key] = state[key].filter((doc) => doc._id !== action.payload._id);
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
  updateSongLibraryDiagnostics,
  updateAllSongDocs,
  updateAllFreeFormDocs,
  updateAllTimerDocs,
  updateAllBibleDocs,
  upsertItemInAllDocs,
  upsertItemsInAllDocs,
  removeItemFromAllDocs,
  attachCloudCopyToLocalImageInAllDocs,
  updateLocalImageReferenceInAllDocs,
} = allDocsSlice.actions;

export default allDocsSlice.reducer;
