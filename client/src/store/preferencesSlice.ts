import { createSlice } from "@reduxjs/toolkit";
import { PreferencesType } from "../types";

const initialState: PreferencesType = {
  slidesPerRow: 4,
  formattedLyricsPerRow: 4,
};

export const preferencesSlice = createSlice({
  name: "preferences",
  initialState,
  reducers: {
    increaseSlides: (state) => {
      state.slidesPerRow = Math.min((state.slidesPerRow || 3) + 1, 7);
    },
    decreaseSlides: (state) => {
      state.slidesPerRow = Math.max((state.slidesPerRow || 3) - 1, 3);
    },
    increaseFormattedLyrics: (state) => {
      state.formattedLyricsPerRow = Math.min(
        (state.formattedLyricsPerRow || 3) + 1,
        5
      );
    },
    decreaseFormattedLyrics: (state) => {
      state.formattedLyricsPerRow = Math.max(
        (state.formattedLyricsPerRow || 3) - 1,
        3
      );
    },
  },
});

export const {
  increaseSlides,
  decreaseSlides,
  increaseFormattedLyrics,
  decreaseFormattedLyrics,
} = preferencesSlice.actions;

export default preferencesSlice.reducer;
