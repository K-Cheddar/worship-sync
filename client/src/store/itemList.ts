import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ServiceItem } from "../types";
import generateRandomId from "../utils/generateRandomId";

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
      state.list = action.payload.map((item) => {
        return {
          ...item,
          key: item["_id"] + generateRandomId(),
        };
      });
    },
    removeItemFromList: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => item["_id"] !== action.payload);
    },
    addItemToItemList: (state, action: PayloadAction<ServiceItem>) => {
      const newItemWithId = {
        ...action.payload,
        key: action.payload["_id"] + generateRandomId(),
      };
      state.list.push(newItemWithId);
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
