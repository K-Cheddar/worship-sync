import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { MediaFolder, MediaType } from "../types";
import { normalizeMediaDoc } from "../utils/mediaDocUtils";

export type MediaLoadStatus = "idle" | "loading" | "ready" | "error";

export type MediaState = {
  list: MediaType[];
  folders: MediaFolder[];
  isInitialized: boolean;
  loadStatus: MediaLoadStatus;
};

const initialState: MediaState = {
  list: [],
  folders: [],
  isInitialized: false,
  loadStatus: "idle",
};

export const isMediaLoadSettled = (
  media: Pick<MediaState, "isInitialized" | "loadStatus">,
) => media.isInitialized || media.loadStatus === "error";

export const mediaItemsSlice = createSlice({
  name: "media",
  initialState,
  reducers: {
    updateMediaList: (state, action: PayloadAction<MediaType[]>) => {
      state.list = action.payload;
    },
    setMediaListAndFolders: (
      state,
      action: PayloadAction<{ list: MediaType[]; folders: MediaFolder[] }>,
    ) => {
      state.list = action.payload.list;
      state.folders = action.payload.folders;
    },
    setIsInitialized: (state, action: PayloadAction<boolean>) => {
      state.isInitialized = action.payload;
      state.loadStatus = action.payload ? "ready" : "idle";
    },
    setLoadStatus: (state, action: PayloadAction<MediaLoadStatus>) => {
      state.loadStatus = action.payload;
      state.isInitialized = action.payload === "ready";
    },
    initiateMediaList: (state, action: PayloadAction<MediaType[]>) => {
      state.list = action.payload;
      state.folders = [];
      state.isInitialized = true;
      state.loadStatus = "ready";
    },
    initiateMediaFromDoc: (
      state,
      action: PayloadAction<{ list: MediaType[]; folders: MediaFolder[] }>,
    ) => {
      state.list = action.payload.list;
      state.folders = action.payload.folders;
      state.isInitialized = true;
      state.loadStatus = "ready";
    },
    syncMediaFromRemote: (
      state,
      action: PayloadAction<{ list: MediaType[]; folders: MediaFolder[] }>,
    ) => {
      state.list = action.payload.list;
      state.folders = action.payload.folders;
      state.isInitialized = true;
      state.loadStatus = "ready";
    },
    /**
     * @deprecated Prefer `syncMediaFromRemote` when folders are known.
     * Reconciles list with existing `folders` so `folderId` refs stay valid (see `normalizeMediaDoc`).
     */
    updateMediaListFromRemote: (state, action: PayloadAction<MediaType[]>) => {
      const { list, folders } = normalizeMediaDoc({
        list: action.payload,
        folders: state.folders,
      });
      state.list = list;
      state.folders = folders;
      state.isInitialized = true;
      state.loadStatus = "ready";
    },
    upsertMediaItemFromRemote: (
      state,
      action: PayloadAction<Pick<MediaType, "id"> & Partial<MediaType>>,
    ) => {
      // Replicated item documents and local media broadcasts are full authoritative
      // documents, so omission means the field was removed.
      const item = action.payload;
      const index = state.list.findIndex((row) => row.id === item.id);
      if (index < 0) state.list.push(item as MediaType);
      else state.list[index] = item as MediaType;
      state.isInitialized = true;
      state.loadStatus = "ready";
    },
    removeMediaItemFromRemote: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => item.id !== action.payload);
      state.isInitialized = true;
      state.loadStatus = "ready";
    },
    updateMediaFoldersFromRemote: (state, action: PayloadAction<MediaFolder[]>) => {
      state.folders = action.payload;
      state.isInitialized = true;
      state.loadStatus = "ready";
    },
    removeItemFromMediaList: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => item.id !== action.payload);
    },
    addItemToMediaList: (state, action: PayloadAction<MediaType>) => {
      state.list.push(action.payload);
    },
    updateMediaItemFields: (
      state,
      action: PayloadAction<{ id: string; patch: Partial<MediaType> }>,
    ) => {
      const { id, patch } = action.payload;
      const idx = state.list.findIndex((item) => item.id === id);
      if (idx === -1) return;
      state.list[idx] = { ...state.list[idx], ...patch, id };
    },
  },
});

export const {
  updateMediaList,
  setMediaListAndFolders,
  removeItemFromMediaList,
  addItemToMediaList,
  updateMediaItemFields,
  initiateMediaList,
  initiateMediaFromDoc,
  setIsInitialized,
  setLoadStatus,
  syncMediaFromRemote,
  updateMediaListFromRemote,
  upsertMediaItemFromRemote,
  removeMediaItemFromRemote,
  updateMediaFoldersFromRemote,
} = mediaItemsSlice.actions;

export default mediaItemsSlice.reducer;
