import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { PreferencesType } from "../types";

export type SelectedPreferenceType =
  | "defaultSongBackground"
  | "defaultTimerBackground"
  | "defaultBibleBackground"
  | "defaultFreeFormBackground"
  | "defaultSongBackgroundBrightness"
  | "defaultTimerBackgroundBrightness"
  | "defaultBibleBackgroundBrightness"
  | "defaultFreeFormBackgroundBrightness"
  | "defaultSlidesPerRow"
  | "defaultSlidesPerRowMobile"
  | "defaultFormattedLyricsPerRow"
  | "defaultMediaItemsPerRow"
  | "defaultShouldShowItemEditor"
  | "defaultIsMediaExpanded"
  | "";

type PreferencesState = {
  isLoading: boolean;
  selectedPreference: SelectedPreferenceType;
  preferences: PreferencesType;
  slidesPerRow: number;
  slidesPerRowMobile: number;
  formattedLyricsPerRow: number;
  mediaItemsPerRow: number;
  shouldShowItemEditor: boolean;
  isMediaExpanded: boolean;
};

const initialState: PreferencesState = {
  preferences: {
    defaultSongBackground:
      "https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/WorshipBackground_ycr280?_a=DATAg1AAZAA0",
    defaultTimerBackground: "",
    defaultBibleBackground:
      "https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds/bible-background_mlek3e?_a=DATAg1AAZAA0",
    defaultFreeFormBackground:
      "https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds/simple-background-2048x1152_zj96ie?_a=DATAg1AAZAA0",
    defaultSongBackgroundBrightness: 50,
    defaultTimerBackgroundBrightness: 75,
    defaultBibleBackgroundBrightness: 60,
    defaultFreeFormBackgroundBrightness: 100,
    defaultSlidesPerRow: 4,
    defaultSlidesPerRowMobile: 3,
    defaultFormattedLyricsPerRow: 4,
    defaultMediaItemsPerRow: 4,
    defaultShouldShowItemEditor: true,
    defaultIsMediaExpanded: false,
  },
  slidesPerRow: 4,
  slidesPerRowMobile: 3,
  formattedLyricsPerRow: 4,
  mediaItemsPerRow: 4,
  shouldShowItemEditor: true,
  isMediaExpanded: false,
  isLoading: true,
  selectedPreference: "",
};

export const preferencesSlice = createSlice({
  name: "preferences",
  initialState,
  reducers: {
    // Set Default Preferences

    setDefaultPreferences: (
      state,
      action: PayloadAction<Partial<PreferencesType>>
    ) => {
      state.preferences = { ...state.preferences, ...action.payload };
    },
    setDefaultSongBackgroundBrightness: (
      state,
      action: PayloadAction<number>
    ) => {
      state.preferences.defaultSongBackgroundBrightness = Math.min(
        Math.max(action.payload, 10),
        100
      );
    },
    setDefaultTimerBackgroundBrightness: (
      state,
      action: PayloadAction<number>
    ) => {
      state.preferences.defaultTimerBackgroundBrightness = Math.min(
        Math.max(action.payload, 10),
        100
      );
    },
    setDefaultBibleBackgroundBrightness: (
      state,
      action: PayloadAction<number>
    ) => {
      state.preferences.defaultBibleBackgroundBrightness = Math.min(
        Math.max(action.payload, 10),
        100
      );
    },
    setDefaultFreeFormBackgroundBrightness: (
      state,
      action: PayloadAction<number>
    ) => {
      state.preferences.defaultFreeFormBackgroundBrightness = Math.min(
        Math.max(action.payload, 10),
        100
      );
    },
    setDefaultSlidesPerRow: (state, action: PayloadAction<number>) => {
      state.preferences.defaultSlidesPerRow = Math.min(
        Math.max(action.payload, 1),
        7
      );
    },
    setDefaultSlidesPerRowMobile: (state, action: PayloadAction<number>) => {
      state.preferences.defaultSlidesPerRowMobile = Math.min(
        Math.max(action.payload, 1),
        7
      );
    },
    setDefaultFormattedLyricsPerRow: (state, action: PayloadAction<number>) => {
      state.preferences.defaultFormattedLyricsPerRow = Math.min(
        Math.max(action.payload, 1),
        4
      );
    },
    setDefaultMediaItemsPerRow: (state, action: PayloadAction<number>) => {
      state.preferences.defaultMediaItemsPerRow = Math.min(
        Math.max(action.payload, 1),
        7
      );
    },

    // Initiate Preferences

    initiatePreferences: (state, action: PayloadAction<PreferencesType>) => {
      state.preferences = {
        defaultSongBackground:
          action.payload.defaultSongBackground ||
          initialState.preferences.defaultSongBackground,
        defaultTimerBackground:
          action.payload.defaultTimerBackground ||
          initialState.preferences.defaultTimerBackground,
        defaultBibleBackground:
          action.payload.defaultBibleBackground ||
          initialState.preferences.defaultBibleBackground,
        defaultFreeFormBackground:
          action.payload.defaultFreeFormBackground ||
          initialState.preferences.defaultFreeFormBackground,
        defaultSongBackgroundBrightness:
          action.payload.defaultSongBackgroundBrightness ||
          initialState.preferences.defaultSongBackgroundBrightness,
        defaultTimerBackgroundBrightness:
          action.payload.defaultTimerBackgroundBrightness ||
          initialState.preferences.defaultTimerBackgroundBrightness,
        defaultBibleBackgroundBrightness:
          action.payload.defaultBibleBackgroundBrightness ||
          initialState.preferences.defaultBibleBackgroundBrightness,
        defaultFreeFormBackgroundBrightness:
          action.payload.defaultFreeFormBackgroundBrightness ||
          initialState.preferences.defaultFreeFormBackgroundBrightness,
        defaultSlidesPerRow:
          action.payload.defaultSlidesPerRow ||
          initialState.preferences.defaultSlidesPerRow,
        defaultSlidesPerRowMobile:
          action.payload.defaultSlidesPerRowMobile ||
          initialState.preferences.defaultSlidesPerRowMobile,
        defaultFormattedLyricsPerRow:
          action.payload.defaultFormattedLyricsPerRow ||
          initialState.preferences.defaultFormattedLyricsPerRow,
        defaultMediaItemsPerRow:
          action.payload.defaultMediaItemsPerRow ||
          initialState.preferences.defaultMediaItemsPerRow,
        defaultShouldShowItemEditor:
          action.payload.defaultShouldShowItemEditor ||
          initialState.preferences.defaultShouldShowItemEditor,
        defaultIsMediaExpanded:
          action.payload.defaultIsMediaExpanded ||
          initialState.preferences.defaultIsMediaExpanded,
      };

      state.slidesPerRow =
        action.payload.defaultSlidesPerRow || initialState.slidesPerRow;
      state.slidesPerRowMobile =
        action.payload.defaultSlidesPerRowMobile ||
        initialState.slidesPerRowMobile;
      state.formattedLyricsPerRow =
        action.payload.defaultFormattedLyricsPerRow ||
        initialState.formattedLyricsPerRow;
      state.mediaItemsPerRow =
        action.payload.defaultMediaItemsPerRow || initialState.mediaItemsPerRow;
      state.shouldShowItemEditor =
        action.payload.defaultShouldShowItemEditor ||
        initialState.shouldShowItemEditor;
      state.isMediaExpanded =
        action.payload.defaultIsMediaExpanded || initialState.isMediaExpanded;
    },

    // Temporary Preferences Below

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
    setIsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setSelectedPreference: (
      state,
      action: PayloadAction<SelectedPreferenceType>
    ) => {
      state.selectedPreference = action.payload;
    },
  },
});

export const {
  setDefaultPreferences,
  setDefaultSongBackgroundBrightness,
  setDefaultTimerBackgroundBrightness,
  setDefaultBibleBackgroundBrightness,
  setDefaultFreeFormBackgroundBrightness,
  setDefaultSlidesPerRow,
  setDefaultSlidesPerRowMobile,
  setDefaultFormattedLyricsPerRow,
  setDefaultMediaItemsPerRow,
  initiatePreferences,
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
  setIsLoading,
  setSelectedPreference,
} = preferencesSlice.actions;

export default preferencesSlice.reducer;
