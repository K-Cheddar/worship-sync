import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ServiceItem } from "../types";
import type { LocalImageReferencePatch } from "../utils/localImageAssets";

type AllItems = {
  list: ServiceItem[];
  isAllItemsLoading: boolean;
  songSearchValue: string;
  freeFormSearchValue: string;
  timerSearchValue: string;
  isInitialized: boolean;
};

const initialState: AllItems = {
  list: [],
  isAllItemsLoading: true,
  songSearchValue: "",
  freeFormSearchValue: "",
  timerSearchValue: "",
  isInitialized: false,
};

export const allItemsSlice = createSlice({
  name: "allItems",
  initialState,
  reducers: {
    updateAllItemsList: (state, action: PayloadAction<ServiceItem[]>) => {
      state.list = action.payload;
    },
    initiateAllItemsList: (state, action: PayloadAction<ServiceItem[]>) => {
      state.list = action.payload;
      state.isAllItemsLoading = false;
      state.isInitialized = true;
    },
    updateAllItemsListFromRemote: (
      state,
      action: PayloadAction<ServiceItem[]>,
    ) => {
      state.list = action.payload;
    },
    removeItemFromAllItemsList: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => item._id !== action.payload);
    },
    addItemToAllItemsList: (state, action: PayloadAction<ServiceItem>) => {
      state.list.push(action.payload);
    },
    upsertItemInAllItemsList: (state, action: PayloadAction<ServiceItem>) => {
      const itemIndex = state.list.findIndex(
        (item) => item._id === action.payload._id,
      );
      if (itemIndex >= 0) {
        state.list[itemIndex] = action.payload;
        return;
      }
      state.list.push(action.payload);
    },
    attachCloudCopyToLocalImageInAllItems: (
      state,
      action: PayloadAction<{
        itemId: string;
        assetId: string;
        mediaId: string;
        url: string;
      }>,
    ) => {
      const item = state.list.find(
        (candidate) => candidate._id === action.payload.itemId,
      );
      if (!item || item.localImage?.id !== action.payload.assetId) return;
      item.localImage.storagePolicy = "local-and-cloud";
      item.localImage.cloudMediaId = action.payload.mediaId;
      item.localImage.cloudUrl = action.payload.url;
    },
    updateLocalImageReferenceInAllItems: (
      state,
      action: PayloadAction<{
        itemId: string;
        assetId: string;
        patch: LocalImageReferencePatch;
      }>,
    ) => {
      const item = state.list.find(
        (candidate) => candidate._id === action.payload.itemId,
      );
      if (
        !item ||
        item.localImage?.id !== action.payload.assetId ||
        !action.payload.patch.reference
      ) {
        return;
      }
      item.localImage = {
        ...item.localImage,
        ...action.payload.patch.reference,
        id: action.payload.assetId,
      };
    },
    setIsInitialized: (state, action: PayloadAction<boolean>) => {
      state.isInitialized = action.payload;
    },
    setSongSearchValue: (state, action: PayloadAction<string>) => {
      state.songSearchValue = action.payload;
    },
    setFreeFormSearchValue: (state, action: PayloadAction<string>) => {
      state.freeFormSearchValue = action.payload;
    },
    setTimerSearchValue: (state, action: PayloadAction<string>) => {
      state.timerSearchValue = action.payload;
    },
  },
});

export const {
  updateAllItemsList,
  removeItemFromAllItemsList,
  addItemToAllItemsList,
  upsertItemInAllItemsList,
  initiateAllItemsList,
  updateAllItemsListFromRemote,
  setIsInitialized,
  setSongSearchValue,
  setFreeFormSearchValue,
  setTimerSearchValue,
  attachCloudCopyToLocalImageInAllItems,
  updateLocalImageReferenceInAllItems,
} = allItemsSlice.actions;

export default allItemsSlice.reducer;
