import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ServiceItem } from "../types";

type AllItems = {
  list: ServiceItem[];
};

const initialState: AllItems = {
  list: [],
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
    },
    removeItemFromAllItemsList: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => item["_id"] !== action.payload);
    },
    addItemToAllItemsList: (state, action: PayloadAction<ServiceItem>) => {
      state.list.push(action.payload);
    },
  },
});

export const {
  updateAllItemsList,
  removeItemFromAllItemsList,
  addItemToAllItemsList,
  initiateAllItemsList,
} = allItemsSlice.actions;

export default allItemsSlice.reducer;
