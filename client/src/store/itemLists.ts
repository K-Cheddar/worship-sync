import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ItemList } from "../types";

type ItemListState = {
  currentLists: ItemList[];
  allLists: ItemList[];
};

const initialState: ItemListState = {
  currentLists: [],
  allLists: [],
};

export const itemListsSlice = createSlice({
  name: "itemLists",
  initialState,
  reducers: {
    updateItemLists: (state, action: PayloadAction<ItemList[]>) => {
      state.currentLists = action.payload;
    },
    initiateItemLists: (state, action: PayloadAction<ItemList[]>) => {
      state.currentLists = action.payload;
    },
    removeFromItemLists: (state, action: PayloadAction<string>) => {
      state.currentLists = state.currentLists.filter((item) => {
        return item.id !== action.payload;
      });
    },
    updateAllItemLists: (state, action: PayloadAction<ItemList[]>) => {
      state.allLists = action.payload;
    },
    initiateAllItemLists: (state, action: PayloadAction<ItemList[]>) => {
      state.allLists = action.payload;
    },
    removeFromAllItemLists: (state, action: PayloadAction<string>) => {
      state.allLists = state.allLists.filter((item) => {
        return item.id !== action.payload;
      });
    },
  },
});

export const {
  updateItemLists,
  removeFromItemLists,
  initiateItemLists,
  updateAllItemLists,
  removeFromAllItemLists,
  initiateAllItemLists,
} = itemListsSlice.actions;

export default itemListsSlice.reducer;
