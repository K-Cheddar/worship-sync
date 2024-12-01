import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { PreferencesType } from "../types";

const initialState: PreferencesType = {
  slidesPerRow: 4,
  formattedLyricsPerRow: 4,
  mediaItemsPerRow: 4,
  shouldShowItemEditor: true,
  isMediaExpanded: false,
};

export const preferencesSlice = createSlice({
  name: "preferences",
  initialState,
  reducers: {
    increaseSlides: (state) => {
      state.slidesPerRow = Math.min((state.slidesPerRow || 3) + 1, 7);
    },
    decreaseSlides: (state) => {
      state.slidesPerRow = Math.max((state.slidesPerRow || 3) - 1, 1);
    },
    increaseFormattedLyrics: (state) => {
      state.formattedLyricsPerRow = Math.min(
        (state.formattedLyricsPerRow || 3) + 1,
        4
      );
    },
    decreaseFormattedLyrics: (state) => {
      state.formattedLyricsPerRow = Math.max(
        (state.formattedLyricsPerRow || 3) - 1,
        1
      );
    },
    increaseMediaItems: (state) => {
      state.mediaItemsPerRow = Math.min((state.mediaItemsPerRow || 4) + 1, 7);
    },
    decreaseMediaItems: (state) => {
      state.mediaItemsPerRow = Math.max((state.mediaItemsPerRow || 4) - 1, 2);
    },
    setShouldShowItemEditor: (state, action: PayloadAction<boolean>) => {
      state.shouldShowItemEditor = action.payload;
    },
    setIsMediaExpanded: (state, action: PayloadAction<boolean>) => {
      state.isMediaExpanded = action.payload;
    },
  },
});

export const {
  increaseSlides,
  decreaseSlides,
  increaseFormattedLyrics,
  decreaseFormattedLyrics,
  setShouldShowItemEditor,
  setIsMediaExpanded,
  increaseMediaItems,
  decreaseMediaItems,
} = preferencesSlice.actions;

export default preferencesSlice.reducer;
