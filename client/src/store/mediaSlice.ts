import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { MediaType } from "../types";

type MediaState = {
  list: MediaType[];
  isInitialized: boolean;
};

const initialState: MediaState = {
  list: [],
  isInitialized: false,
};

export const mediaItemsSlice = createSlice({
  name: "media",
  initialState,
  reducers: {
    updateMediaList: (state, action: PayloadAction<MediaType[]>) => {
      state.list = action.payload;
    },
    initiateMediaList: (state, action: PayloadAction<MediaType[]>) => {
      state.list = action.payload;
      state.isInitialized = true;
    },
    updateMediaListFromRemote: (state, action: PayloadAction<MediaType[]>) => {
      state.list = action.payload;
    },
    removeItemFromMediaList: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => item.id !== action.payload);
    },
    addItemToMediaList: (state, action: PayloadAction<MediaType>) => {
      state.list.push(action.payload);
    },
  },
});

export const {
  updateMediaList,
  removeItemFromMediaList,
  addItemToMediaList,
  initiateMediaList,
  updateMediaListFromRemote,
} = mediaItemsSlice.actions;

export default mediaItemsSlice.reducer;
