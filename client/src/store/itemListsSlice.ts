import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ItemList } from "../types";

type ItemListState = {
  currentLists: ItemList[];
  allLists: ItemList[];
  selectedList: ItemList | undefined;
};

const initialState: ItemListState = {
  currentLists: [],
  allLists: [],
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
    selectItemList: (state, action: PayloadAction<string>) => {
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
  updateAllItemLists,
  removeFromAllItemLists,
  initiateAllItemLists,
  selectItemList,
} = itemListsSlice.actions;

export default itemListsSlice.reducer;
