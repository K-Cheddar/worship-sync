import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ItemList } from "../types";

type ItemListState = {
  currentLists: ItemList[];
  selectedList: ItemList | undefined;
  isInitialized: boolean;
};

const initialState: ItemListState = {
  currentLists: [],
  selectedList: undefined,
  isInitialized: false,
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
      state.isInitialized = true;
    },
    updateItemListsFromRemote: (state, action: PayloadAction<ItemList[]>) => {
      state.currentLists = action.payload;
    },
    removeFromItemLists: (state, action: PayloadAction<string>) => {
      state.currentLists = state.currentLists.filter((item) => {
        return item._id !== action.payload;
      });
    },
    selectItemList: (state, action: PayloadAction<string>) => {
      state.selectedList = state.currentLists.find(
        (item) => item._id === action.payload
      );
    },
    setInitialItemList: (state, action: PayloadAction<string>) => {
      state.selectedList = state.currentLists.find(
        (item) => item._id === action.payload
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
  updateItemListsFromRemote,
} = itemListsSlice.actions;

export default itemListsSlice.reducer;
