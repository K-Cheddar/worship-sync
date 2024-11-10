import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DBServiceItem, ServiceItem } from "../types";
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
    initiateItemList: (state, action: PayloadAction<DBServiceItem[]>) => {
      state.list = action.payload.map((item) => {
        return {
          ...item,
          listId: generateRandomId(),
        };
      });
    },
    removeItemFromList: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => {
        return item.listId !== action.payload;
      });
    },
    addItemToItemList: (state, action: PayloadAction<DBServiceItem>) => {
      const newItemWithId = {
        ...action.payload,
        listId: generateRandomId(),
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
