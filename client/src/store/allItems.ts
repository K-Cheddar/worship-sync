import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DBServiceItem } from "../types";

type AllItems = {
  list: DBServiceItem[];
};

const initialState: AllItems = {
  list: [],
};

export const allItemsSlice = createSlice({
  name: "allItems",
  initialState,
  reducers: {
    updateAllItemsList: (state, action: PayloadAction<DBServiceItem[]>) => {
      state.list = action.payload;
    },
    removeItemFromAllItemsList: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => item["_id"] !== action.payload);
    },
    addItemToAllItemsList: (state, action: PayloadAction<DBServiceItem>) => {
      state.list.push(action.payload);
    },
  },
});

export const {
  updateAllItemsList,
  removeItemFromAllItemsList,
  addItemToAllItemsList,
} = allItemsSlice.actions;

export default allItemsSlice.reducer;
