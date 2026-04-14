import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ItemList } from "../types";

type ItemListState = {
  currentLists: ItemList[];
  activeList: ItemList | undefined;
  selectedList: ItemList | undefined;
  isInitialized: boolean;
};

const initialState: ItemListState = {
  currentLists: [],
  activeList: undefined,
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

    setIsInitialized: (state, action: PayloadAction<boolean>) => {
      state.isInitialized = action.payload;
    },
    initiateItemLists: (state, action: PayloadAction<ItemList[]>) => {
      state.currentLists = action.payload;
      state.activeList = action.payload[0];
      state.selectedList = action.payload[0];
      state.isInitialized = true;
    },
    updateItemListsFromRemote: (state, action: PayloadAction<ItemList[]>) => {
      const lists = action.payload;
      state.currentLists = lists;
      if (lists.length === 0) {
        state.activeList = undefined;
        state.selectedList = undefined;
        return;
      }
      const ids = new Set(lists.map((l) => l._id));
      const selectedId = state.selectedList?._id;
      state.selectedList =
        selectedId && ids.has(selectedId)
          ? lists.find((l) => l._id === selectedId)!
          : lists[0];
      const activeId = state.activeList?._id;
      state.activeList =
        activeId && ids.has(activeId)
          ? lists.find((l) => l._id === activeId)!
          : lists[0];
    },
    removeFromItemLists: (state, action: PayloadAction<string>) => {
      state.currentLists = state.currentLists.filter((item) => {
        return item._id !== action.payload;
      });
      if (state.activeList?._id === action.payload) {
        state.activeList = state.currentLists[0];
      }
      if (state.selectedList?._id === action.payload) {
        state.selectedList = state.currentLists[0];
      }
    },
    selectItemList: (state, action: PayloadAction<string>) => {
      state.selectedList = state.currentLists.find(
        (item) => item._id === action.payload,
      );
    },
    setActiveItemList: (state, action: PayloadAction<string>) => {
      state.activeList = state.currentLists.find(
        (item) => item._id === action.payload,
      );
    },
    setInitialItemList: (state, action: PayloadAction<string>) => {
      state.activeList = state.currentLists.find(
        (item) => item._id === action.payload,
      );
      state.selectedList = state.activeList;
    },
    forceUpdate: () => {},
  },
});

export const {
  updateItemLists,
  removeFromItemLists,
  initiateItemLists,
  setIsInitialized,
  selectItemList,
  setActiveItemList,
  setInitialItemList,
  updateItemListsFromRemote,
  forceUpdate,
} = itemListsSlice.actions;

export default itemListsSlice.reducer;
