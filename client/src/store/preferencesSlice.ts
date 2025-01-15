import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { PreferencesType } from "../types";

const initialState: PreferencesType = {
  slidesPerRow: 4,
  slidesPerRowMobile: 3,
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
      state.slidesPerRow = Math.min((state.slidesPerRow || 4) + 1, 7);
    },
    increaseSlidesMobile: (state) => {
      state.slidesPerRowMobile = Math.min(
        (state.slidesPerRowMobile || 4) + 1,
        7
      );
    },
    decreaseSlides: (state) => {
      state.slidesPerRow = Math.max((state.slidesPerRow || 3) - 1, 1);
    },
    decreaseSlidesMobile: (state) => {
      state.slidesPerRowMobile = Math.max(
        (state.slidesPerRowMobile || 3) - 1,
        1
      );
    },
    setSlides: (state, action: PayloadAction<number>) => {
      state.slidesPerRow = action.payload;
    },
    setSlidesMobile: (state, action: PayloadAction<number>) => {
      state.slidesPerRowMobile = action.payload;
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
    setFormattedLyrics: (state, action: PayloadAction<number>) => {
      state.formattedLyricsPerRow = action.payload;
    },
    increaseMediaItems: (state) => {
      state.mediaItemsPerRow = Math.min((state.mediaItemsPerRow || 4) + 1, 7);
    },
    decreaseMediaItems: (state) => {
      state.mediaItemsPerRow = Math.max((state.mediaItemsPerRow || 4) - 1, 2);
    },
    setMediaItems: (state, action: PayloadAction<number>) => {
      state.mediaItemsPerRow = action.payload;
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
  increaseSlidesMobile,
  decreaseSlides,
  decreaseSlidesMobile,
  setSlides,
  setSlidesMobile,
  increaseFormattedLyrics,
  decreaseFormattedLyrics,
  setFormattedLyrics,
  setShouldShowItemEditor,
  setIsMediaExpanded,
  increaseMediaItems,
  decreaseMediaItems,
  setMediaItems,
} = preferencesSlice.actions;

export default preferencesSlice.reducer;
