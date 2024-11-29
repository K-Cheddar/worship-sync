import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ItemList, ServiceItem } from "../types";

type ItemListState = {
  currentLists: ItemList[];
  selectedList: ItemList | undefined;
};

const initialState: ItemListState = {
  currentLists: [],
  selectedList: undefined,
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
      state.selectedList = action.payload[0];
    },
    removeFromItemLists: (state, action: PayloadAction<string>) => {
      state.currentLists = state.currentLists.filter((item) => {
        return item.id !== action.payload;
      });
    },
    selectItemList: (state, action: PayloadAction<string>) => {
      state.selectedList = state.currentLists.find(
        (item) => item.id === action.payload
      );
    },
    setInitialItemList: (state, action: PayloadAction<string>) => {
      state.selectedList = state.currentLists.find(
        (item) => item.id === action.payload
      );
    },
  },
});

export const {
  updateItemLists,
  removeFromItemLists,
  initiateItemLists,
  selectItemList,
  setInitialItemList,
} = itemListsSlice.actions;

export default itemListsSlice.reducer;
