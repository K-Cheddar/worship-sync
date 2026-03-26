import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ServiceItem } from "../types";
import generateRandomId from "../utils/generateRandomId";

type ItemListState = {
  list: ServiceItem[];
  isLoading: boolean;
  selectedItemListId: string; // each item has a unique listId even if their ids are the same
  insertPointIndex: number; // index of item after which new items are inserted (-1 = none)
  hasPendingUpdate: boolean;
  initialItems: string[];
  isInitialized: boolean;
};

const initialState: ItemListState = {
  list: [],
  isLoading: true,
  selectedItemListId: "",
  insertPointIndex: -1,
  hasPendingUpdate: false,
  initialItems: [],
  isInitialized: false,
};

export const itemListSlice = createSlice({
  name: "itemList",
  initialState,
  reducers: {
    updateItemList: (state, action: PayloadAction<ServiceItem[]>) => {
      state.list = action.payload;
      state.insertPointIndex = Math.max(
        -1,
        Math.min(state.insertPointIndex, action.payload.length - 1),
      );
      state.hasPendingUpdate = true;
    },
    setActiveItemInList: (state, action: PayloadAction<string>) => {
      state.selectedItemListId = action.payload;
      const idx = state.list.findIndex((e) => e.listId === action.payload);
      state.insertPointIndex = idx >= 0 ? idx : -1;
    },
    initiateItemList: (state, action: PayloadAction<ServiceItem[]>) => {
      state.list = action.payload.map((item) => ({
        ...item,
        listId: item.listId || generateRandomId(),
      }));
      state.initialItems = state.list.map((item) => item.listId);
      state.insertPointIndex = -1;
      state.isInitialized = true;
    },
    updateItemListFromRemote: (state, action: PayloadAction<ServiceItem[]>) => {
      state.list = action.payload.map((item) => ({
        ...item,
        listId: item.listId || generateRandomId(),
      }));
      state.insertPointIndex = Math.max(
        -1,
        Math.min(state.insertPointIndex, state.list.length - 1),
      );
    },
    removeItemFromList: (state, action: PayloadAction<string>) => {
      const idx = state.list.findIndex((item) => item.listId === action.payload);
      if (idx >= 0) {
        if (state.insertPointIndex > idx) {
          state.insertPointIndex -= 1;
        } else if (state.insertPointIndex === idx) {
          state.insertPointIndex = idx > 0 ? idx - 1 : -1;
        }
      }
      state.list = state.list.filter((item) => item.listId !== action.payload);
      state.hasPendingUpdate = true;
    },
    removeItemsFromList: (state, action: PayloadAction<string[]>) => {
      const ids = new Set(action.payload);
      const indicesToRemove = state.list
        .map((item, i) => (ids.has(item.listId) ? i : -1))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);
      let shift = 0;
      for (const i of indicesToRemove) {
        const adjusted = i - shift;
        if (state.insertPointIndex > adjusted) {
          state.insertPointIndex -= 1;
        } else if (state.insertPointIndex === adjusted) {
          state.insertPointIndex = adjusted > 0 ? adjusted - 1 : -1;
        }
        shift += 1;
      }
      state.list = state.list.filter((item) => !ids.has(item.listId));
      state.hasPendingUpdate = true;
    },
    removeItemFromListById: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => item._id !== action.payload);
      state.insertPointIndex = Math.max(
        -1,
        Math.min(state.insertPointIndex, state.list.length - 1),
      );
      state.hasPendingUpdate = true;
    },
    addItemToItemList: (state, action: PayloadAction<ServiceItem>) => {
      const newItem = {
        ...action.payload,
        listId: action.payload.listId || generateRandomId(),
      };
      const anchorIndex =
        state.insertPointIndex >= 0
          ? state.insertPointIndex
          : state.list.findIndex(
              (e) => e.listId === state.selectedItemListId,
            );
      let insertAt: number;
      if (anchorIndex >= 0) {
        insertAt =
          newItem.type === "heading" ? anchorIndex : anchorIndex + 1;
      } else {
        insertAt =
          newItem.type === "heading" ? 0 : state.list.length;
      }
      const index = Math.max(0, Math.min(insertAt, state.list.length));
      state.list.splice(index, 0, newItem);
      if (newItem.type !== "heading") {
        state.selectedItemListId = newItem.listId;
        state.insertPointIndex = index;
      }
      state.hasPendingUpdate = true;
    },
    setIsInitialized: (state, action: PayloadAction<boolean>) => {
      state.isInitialized = action.payload;
    },
    setItemListIsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setHasPendingUpdate: (state, action: PayloadAction<boolean>) => {
      state.hasPendingUpdate = action.payload;
    },
    forceUpdate: (state) => {
      state.hasPendingUpdate = true;
    },
    addToInitialItems: (state, action: PayloadAction<string[]>) => {
      state.initialItems = [...state.initialItems, ...action.payload];
    },
  },
});

export const {
  updateItemList,
  removeItemFromList,
  removeItemsFromList,
  addItemToItemList,
  initiateItemList,
  setIsInitialized,
  setActiveItemInList,
  setItemListIsLoading,
  removeItemFromListById,
  updateItemListFromRemote,
  setHasPendingUpdate,
  addToInitialItems,
  forceUpdate,
} = itemListSlice.actions;

export default itemListSlice.reducer;
