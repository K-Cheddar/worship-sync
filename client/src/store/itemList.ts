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
      state.list = action.payload.map((item) => ({
        ...item,
        listId: generateRandomId(),
      }));
    },
    removeItemFromList: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => {
        return item.listId !== action.payload;
      });
    },
    addItemToItemList: (state, action: PayloadAction<ServiceItem>) => {
      if (action.payload.listId) {
        state.list.push(action.payload);
      } else {
        state.list.push({ ...action.payload, listId: generateRandomId() });
      }
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
