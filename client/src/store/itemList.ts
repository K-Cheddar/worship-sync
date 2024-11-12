import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ServiceItem } from "../types";

type ItemListState = {
  list: ServiceItem[];
};

const initialState: ItemListState = {
  list: [],
};

export const itemListSlice = createSlice({
  name: "itemList",
  initialState,
  reducers: {
    updateItemList: (state, action: PayloadAction<ServiceItem[]>) => {
      state.list = action.payload;
    },
    initiateItemList: (state, action: PayloadAction<ServiceItem[]>) => {
      state.list = action.payload;
    },
    removeItemFromList: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => {
        return item._id !== action.payload;
      });
    },
    addItemToItemList: (state, action: PayloadAction<ServiceItem>) => {
      state.list.push(action.payload);
    },
  },
});

export const {
  updateItemList,
  removeItemFromList,
  addItemToItemList,
  initiateItemList,
} = itemListSlice.actions;

export default itemListSlice.reducer;
