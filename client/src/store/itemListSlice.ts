import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ServiceItem } from "../types";
import generateRandomId from "../utils/generateRandomId";

type ItemListState = {
  list: ServiceItem[];
  isLoading: boolean;
  selectedItemListId: string; // each item has a unique listId even if their ids are the same
  hasPendingUpdate: boolean;
  initialItems: string[];
  isInitialized: boolean;
};

const initialState: ItemListState = {
  list: [],
  isLoading: true,
  selectedItemListId: "",
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
      state.hasPendingUpdate = true;
    },
    setActiveItemInList: (state, action: PayloadAction<string>) => {
      state.selectedItemListId = action.payload;
    },
    initiateItemList: (state, action: PayloadAction<ServiceItem[]>) => {
      state.list = action.payload.map((item) => ({
        ...item,
        listId: item.listId || generateRandomId(),
      }));
      state.initialItems = state.list.map((item) => item.listId);
      state.isInitialized = true;
    },
    updateItemListFromRemote: (state, action: PayloadAction<ServiceItem[]>) => {
      state.list = action.payload.map((item) => ({
        ...item,
        listId: item.listId || generateRandomId(),
      }));
    },
    removeItemFromList: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => {
        return item.listId !== action.payload;
      });
      state.hasPendingUpdate = true;
    },
    removeItemFromListById: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => {
        return item._id !== action.payload;
      });
      state.hasPendingUpdate = true;
    },
    addItemToItemList: (state, action: PayloadAction<ServiceItem>) => {
      const newItem = { ...action.payload, listId: generateRandomId() };
      const selectedIndex = state.list.findIndex(
        (e) => e.listId === state.selectedItemListId
      );
      if (selectedIndex !== -1) {
        const index = newItem.type === "heading" ? selectedIndex : selectedIndex + 1;
        state.list.splice(index, 0, newItem);
      } else if (newItem.type !== "heading") {
        state.list.push(newItem);
      } else {
        state.list.unshift(newItem);
      }
      if (newItem.type !== "heading") {

        state.selectedItemListId = newItem.listId;
      }
      state.hasPendingUpdate = true;
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
  addItemToItemList,
  initiateItemList,
  setActiveItemInList,
  setItemListIsLoading,
  removeItemFromListById,
  updateItemListFromRemote,
  setHasPendingUpdate,
  addToInitialItems,
  forceUpdate,
} = itemListSlice.actions;

export default itemListSlice.reducer;
