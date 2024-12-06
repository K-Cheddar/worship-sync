import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ServiceItem } from "../types";
import generateRandomId from "../utils/generateRandomId";

type ItemListState = {
  list: ServiceItem[];
  isLoading: boolean;
  selectedItemListId: string;
};

const initialState: ItemListState = {
  list: [],
  isLoading: true,
  selectedItemListId: "",
};

export const itemListSlice = createSlice({
  name: "itemList",
  initialState,
  reducers: {
    updateItemList: (state, action: PayloadAction<ServiceItem[]>) => {
      state.list = action.payload;
    },
    setActiveItemInList: (state, action: PayloadAction<string>) => {
      state.selectedItemListId = action.payload;
    },
    initiateItemList: (state, action: PayloadAction<ServiceItem[]>) => {
      state.list = action.payload.map((item) => ({
        ...item,
        listId: generateRandomId(),
      }));
    },
    updateItemListFromRemote: (state, action: PayloadAction<ServiceItem[]>) => {
      state.list = action.payload.map((item) => ({
        ...item,
        listId: item.listId || generateRandomId(),
      }));
    },
    removeItemFromList: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => {
        return item.listId !== action.payload;
      });
    },
    removeItemFromListById: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => {
        return item._id !== action.payload;
      });
    },
    addItemToItemList: (state, action: PayloadAction<ServiceItem>) => {
      const newItem = { ...action.payload, listId: generateRandomId() };
      const selectedIndex = state.list.findIndex(
        (e) => e.listId === state.selectedItemListId
      );
      if (selectedIndex !== -1) {
        state.list.splice(selectedIndex + 1, 0, newItem);
      } else {
        state.list.push(newItem);
      }
    },
    setItemListIsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
  },
});

export const {
  updateItemList,
  removeItemFromList,
  addItemToItemList,
  initiateItemList,
  setActiveItemInList,
  setItemListIsLoading,
  removeItemFromListById,
  updateItemListFromRemote,
} = itemListSlice.actions;

export default itemListSlice.reducer;
