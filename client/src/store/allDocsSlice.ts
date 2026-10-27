import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { DBHeading, DBItem } from "../types";
import type { SongLibraryDiagnostic } from "../utils/songLibraryDiscovery";
import {
  attachCloudCopyToLocalImageItem,
  updateLocalImageReferenceInItem,
  type LocalImageReferencePatch,
} from "../utils/localImageAssets";
import { normalizeSongForLibrary } from "../utils/activeItemSlides";

const normalizeLibrarySong = (song: DBItem): DBItem => normalizeSongForLibrary(
  song.docType === "song-v2-root"
    ? { ...song, slides: [], arrangements: (song.arrangements ?? []).map((arrangement) => ({ ...arrangement, slides: [] })) }
    : song,
);

/** Legacy items may lack docType; explicit non-item discriminators win. */
export const isItemDocument = (value: unknown): value is DBItem | DBHeading => {
  if (!value || typeof value !== "object") return false;
  const doc = value as Record<string, unknown>;
  const isLibraryProjection = doc.docType === "song-v2-root" && doc.type === "song";
  return typeof doc._id === "string" && typeof doc.name === "string" && !doc._id.startsWith("_") && !doc._deleted &&
    (doc.docType === undefined || doc.docType === "item" || doc.docType === "heading" || isLibraryProjection) &&
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
  songLibraryDiagnostics: SongLibraryDiagnostic[];
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
  songLibraryDiagnostics: [],
  allSongDocs: [],
  allFreeFormDocs: [],
  allTimerDocs: [],
  allBibleDocs: [],
  allServiceTimeDocs: [],
  allHeadingDocs: [],
  isInitialized: false,
  error: null,
};

const itemKeys = ["allSongDocs", "allFreeFormDocs", "allTimerDocs", "allBibleDocs", "allServiceTimeDocs"] as const;
const localImageKeys = ["allSongDocs", "allFreeFormDocs", "allTimerDocs", "allBibleDocs"] as const;

export const allDocsSlice = createSlice({
  name: "allDocs",
  initialState: () => ({ ...initialState, session: ++nextCacheSession }),
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
      const doc = action.payload.type === "song" ? normalizeLibrarySong(action.payload) : action.payload;
      const key = getDocsKey(doc.type);
      if (!key) return;
      const arr = state[key];
      const idx = arr.findIndex((candidate) => candidate._id === doc._id);
      if (doc.type === "song" && doc.docType !== "song-v2-root" &&
        (arr[idx]?.docType === "song-v2-root" || state.songLibraryDiagnostics.some((diagnostic) => diagnostic.songId === doc._id))) return;
      if (idx >= 0) arr[idx] = doc;
      else arr.push(doc);
    },
    upsertItemsInAllDocs: (state, action: PayloadAction<DBItem[]>) => {
      for (const inputDoc of action.payload) {
        const doc = inputDoc.type === "song" ? normalizeLibrarySong(inputDoc) : inputDoc;
        const key = getDocsKey(doc.type);
        if (!key) continue;
        const arr = state[key];
        const idx = arr.findIndex((candidate) => candidate._id === doc._id);
        if (doc.type === "song" && doc.docType !== "song-v2-root" &&
          (arr[idx]?.docType === "song-v2-root" || state.songLibraryDiagnostics.some((diagnostic) => diagnostic.songId === doc._id))) continue;
        if (idx >= 0) arr[idx] = doc;
        else arr.push(doc);
      }
    },
    removeItemFromAllDocs: (state, action: PayloadAction<{ _id: string; type: string }>) => {
      const key = getDocsKey(action.payload.type);
      if (!key) return;
      state[key] = state[key].filter((doc) => doc._id !== action.payload._id);
    },
    attachCloudCopyToLocalImageInAllDocs: (state, action: PayloadAction<{
      itemId: string;
      assetId: string;
      mediaId: string;
      url: string;
    }>) => {
      for (const key of localImageKeys) {
        const index = state[key].findIndex((item) => item._id === action.payload.itemId);
        if (index < 0) continue;
        state[key][index] = attachCloudCopyToLocalImageItem(
          state[key][index], action.payload.assetId,
          { mediaId: action.payload.mediaId, url: action.payload.url },
        );
        return;
      }
    },
    updateLocalImageReferenceInAllDocs: (state, action: PayloadAction<{
      itemId: string;
      assetId: string;
      patch: LocalImageReferencePatch;
    }>) => {
      for (const key of localImageKeys) {
        const index = state[key].findIndex((item) => item._id === action.payload.itemId);
        if (index < 0) continue;
        state[key][index] = updateLocalImageReferenceInItem(
          state[key][index], action.payload.assetId, action.payload.patch,
        );
        return;
      }
    },
    resetItemCache: (state) => ({ ...initialState, session: state.session }),
    hydrateItemCache: (state, action: PayloadAction<Array<DBItem | DBHeading>>) => {
      state.allSongDocs = [];
      state.allFreeFormDocs = [];
      state.allTimerDocs = [];
      state.allBibleDocs = [];
      state.allServiceTimeDocs = [];
      state.allHeadingDocs = [];
      for (const inputDoc of action.payload) {
        if (inputDoc.type === "heading") state.allHeadingDocs.push(inputDoc as DBHeading);
        else {
          const doc = inputDoc.type === "song" ? normalizeLibrarySong(inputDoc as DBItem) : inputDoc as DBItem;
          const key = getDocsKey(doc.type);
          if (key) state[key].push(doc);
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
      const { id, doc: inputDoc, deleted } = action.payload;
      if (deleted) {
        const cached = [...itemKeys.map((key) => state[key]), state.allHeadingDocs]
          .some((docs) => docs.some((item) => item._id === id));
        if (!cached) return;
      } else if (!isItemDocument(inputDoc)) return;

      const doc = inputDoc?.type === "song" ? normalizeLibrarySong(inputDoc as DBItem) : inputDoc;
      if (!deleted && doc?.type === "song" && doc.docType !== "song-v2-root") {
        const existingSong = state.allSongDocs.find((item) => item._id === id);
        if (existingSong?.docType === "song-v2-root" || state.songLibraryDiagnostics.some((diagnostic) => diagnostic.songId === id)) return;
      }
      state.changeVersion += 1;
      if (!deleted && doc?.type === "song" && doc.docType === "song-v2-root") {
        state.songLibraryDiagnostics = state.songLibraryDiagnostics.filter((diagnostic) => diagnostic.songId !== id);
      }
      for (const key of itemKeys) {
        const index = state[key].findIndex((item) => item._id === id);
        if (!deleted && doc && getDocsKey(doc.type) === key) {
          if (index < 0) state[key].push(doc as DBItem);
          else state[key][index] = doc as DBItem;
        } else if (index >= 0) state[key].splice(index, 1);
      }
      const headingIndex = state.allHeadingDocs.findIndex((item) => item._id === id);
      if (!deleted && doc?.type === "heading") {
        if (headingIndex < 0) state.allHeadingDocs.push(doc as DBHeading);
        else state.allHeadingDocs[headingIndex] = doc as DBHeading;
      } else if (headingIndex >= 0) state.allHeadingDocs.splice(headingIndex, 1);
    },
    setItemCacheError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
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
  resetItemCache,
  hydrateItemCache,
  applyItemDocumentChange,
  setItemCacheError,
} = allDocsSlice.actions;

export default allDocsSlice.reducer;
