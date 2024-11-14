import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Media } from "../types";

type MediaState = {
  list: Media[];
};

const initialState: MediaState = {
  list: [],
};

export const mediaItemsSlice = createSlice({
  name: "media",
  initialState,
  reducers: {
    updateMediaList: (state, action: PayloadAction<Media[]>) => {
      state.list = action.payload;
    },
    initiateMediaList: (state, action: PayloadAction<Media[]>) => {
      state.list = action.payload;
    },
    removeItemFromMediaList: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => item.id !== action.payload);
    },
    addItemToMediaList: (state, action: PayloadAction<Media>) => {
      state.list.push(action.payload);
    },
  },
});

export const {
  updateMediaList,
  removeItemFromMediaList,
  addItemToMediaList,
  initiateMediaList,
} = mediaItemsSlice.actions;

export default mediaItemsSlice.reducer;
