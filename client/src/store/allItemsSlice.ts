import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ServiceItem } from "../types";

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
  initiateAllItemsList,
  updateAllItemsListFromRemote,
  setIsInitialized,
  setSongSearchValue,
  setFreeFormSearchValue,
  setTimerSearchValue,
} = allItemsSlice.actions;

export default allItemsSlice.reducer;
