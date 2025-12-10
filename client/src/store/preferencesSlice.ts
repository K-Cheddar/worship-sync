import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  BibleFontMode,
  PreferencesType,
  MonitorSettingsType,
  ScrollbarWidth,
  Presentation,
  QuickLinkType,
  DBPreferences,
  MediaType,
} from "../types";
import generateRandomId from "../utils/generateRandomId";

export type PreferencesTabType = "defaults" | "quickLinks";

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
  | "defaultSlidesPerRowMusic"
  | "defaultSlidesPerRowMusicMobile"
  | "defaultFormattedLyricsPerRow"
  | "defaultMediaItemsPerRow"
  | "defaultShouldShowItemEditor"
  | "defaultIsMediaExpanded"
  | "defaultBibleFontMode"
  | "";

type PreferencesState = {
  isLoading: boolean;
  selectedPreference: SelectedPreferenceType;
  preferences: PreferencesType;
  monitorSettings: MonitorSettingsType;
  slidesPerRow: number;
  slidesPerRowMobile: number;
  formattedLyricsPerRow: number;
  mediaItemsPerRow: number;
  shouldShowItemEditor: boolean;
  shouldShowStreamFormat: boolean;
  isMediaExpanded: boolean;
  quickLinks: QuickLinkType[];
  defaultQuickLinks: QuickLinkType[];
  selectedQuickLink: QuickLinkType | null;
  tab: PreferencesTabType;
  bibleFontMode: BibleFontMode;
  scrollbarWidth: ScrollbarWidth;
  isInitialized: boolean;
};

const initialState: PreferencesState = {
  preferences: {
    defaultSongBackground: {
      background:
        "https://res.cloudinary.com/portable-media/image/upload/v1/eliathah/WorshipBackground_ycr280?_a=DATAg1AAZAA0",
      mediaInfo: undefined,
    },
    defaultTimerBackground: {
      background: "",
      mediaInfo: undefined,
    },
    defaultBibleBackground: {
      background:
        "https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds/bible-background_mlek3e?_a=DATAg1AAZAA0",
      mediaInfo: undefined,
    },
    defaultFreeFormBackground: {
      background:
        "https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds/simple-background-2048x1152_zj96ie?_a=DATAg1AAZAA0",
      mediaInfo: undefined,
    },
    defaultSongBackgroundBrightness: 50,
    defaultTimerBackgroundBrightness: 75,
    defaultBibleBackgroundBrightness: 60,
    defaultFreeFormBackgroundBrightness: 100,
    defaultSlidesPerRow: 4,
    defaultSlidesPerRowMobile: 3,
    defaultSlidesPerRowMusic: 5,
    defaultSlidesPerRowMusicMobile: 3,
    defaultFormattedLyricsPerRow: 4,
    defaultMediaItemsPerRow: 4,
    defaultShouldShowItemEditor: true,
    defaultIsMediaExpanded: false,
    defaultBibleFontMode: "separate",
  },
  monitorSettings: {
    showClock: true,
    showTimer: true,
    clockFontSize: 15,
    timerFontSize: 4,
    timerId: null,
  },
  slidesPerRow: 4,
  slidesPerRowMobile: 3,
  formattedLyricsPerRow: 4,
  mediaItemsPerRow: 4,
  shouldShowItemEditor: true,
  isMediaExpanded: false,
  shouldShowStreamFormat: false,
  isLoading: true,
  selectedPreference: "",
  defaultQuickLinks: [
    {
      id: generateRandomId(),
      label: "Clear",
      canDelete: false,
      displayType: "projector",
      action: "clear",
    },
    {
      id: generateRandomId(),
      label: "Clear",
      canDelete: false,
      displayType: "monitor",
      action: "clear",
    },
    {
      id: generateRandomId(),
      label: "Clear",
      canDelete: false,
      displayType: "stream",
      action: "clear",
    },
  ],
  quickLinks: [],
  selectedQuickLink: null,
  tab: "defaults",
  bibleFontMode: "separate",
  scrollbarWidth: "thin",
  isInitialized: false,
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
    setDefaultSlidesPerRowMusic: (state, action: PayloadAction<number>) => {
      state.preferences.defaultSlidesPerRowMusic = Math.min(
        Math.max(action.payload, 1),
        7
      );
    },
    setDefaultSlidesPerRowMusicMobile: (
      state,
      action: PayloadAction<number>
    ) => {
      state.preferences.defaultSlidesPerRowMusicMobile = Math.min(
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

    // Quick Links

    setQuickLinks: (state, action: PayloadAction<QuickLinkType[]>) => {
      state.quickLinks = action.payload;
    },
    initiateQuickLinks: (state, action: PayloadAction<QuickLinkType[]>) => {
      state.quickLinks = action.payload || [];
    },
    setSelectedQuickLink: (state, action: PayloadAction<string>) => {
      state.selectedQuickLink =
        state.quickLinks.find((ql) => ql.id === action.payload) || null;
    },
    setSelectedQuickLinkImage: (state, action: PayloadAction<MediaType>) => {
      state.quickLinks.map((ql) => {
        if (ql.id === state.selectedQuickLink?.id) {
          ql.presentationInfo = {
            type: "media",
            name: state.selectedQuickLink?.label || "",
            slide: {
              type: "Media",
              name: "",
              id: generateRandomId(),
              boxes: [
                {
                  id: generateRandomId(),
                  background: action.payload.background,
                  mediaInfo: action.payload,
                  height: 100,
                  width: 100,
                },
              ],
            },
          };
        }
        return ql;
      });
    },
    setSelectedQuickLinkPresentation: (
      state,
      action: PayloadAction<Presentation>
    ) => {
      state.quickLinks.map((ql) => {
        if (ql.id === state.selectedQuickLink?.id) {
          ql.presentationInfo = action.payload;
        }
        return ql;
      });
      state.selectedQuickLink = null;
    },

    setTab: (state, action: PayloadAction<PreferencesTabType>) => {
      state.tab = action.payload;
    },

    // Initiate Preferences

    initiatePreferences: (
      state,
      action: PayloadAction<{ preferences: PreferencesType; isMusic: boolean }>
    ) => {
      const { preferences, isMusic } = action.payload;

      console.log("initiatePreferences", preferences);

      state.preferences = {
        defaultSongBackground: {
          background:
            preferences.defaultSongBackground?.background ||
            initialState.preferences.defaultSongBackground.background,
          mediaInfo:
            preferences.defaultSongBackground?.mediaInfo ||
            initialState.preferences.defaultSongBackground.mediaInfo,
        },
        defaultTimerBackground: {
          background:
            preferences.defaultTimerBackground?.background ||
            initialState.preferences.defaultTimerBackground.background,
          mediaInfo:
            preferences.defaultTimerBackground?.mediaInfo ||
            initialState.preferences.defaultTimerBackground.mediaInfo,
        },
        defaultBibleBackground: {
          background:
            preferences.defaultBibleBackground?.background ||
            initialState.preferences.defaultBibleBackground.background,
          mediaInfo:
            preferences.defaultBibleBackground?.mediaInfo ||
            initialState.preferences.defaultBibleBackground.mediaInfo,
        },
        defaultFreeFormBackground: {
          background:
            preferences.defaultFreeFormBackground?.background ||
            initialState.preferences.defaultFreeFormBackground.background,
          mediaInfo:
            preferences.defaultFreeFormBackground?.mediaInfo ||
            initialState.preferences.defaultFreeFormBackground.mediaInfo,
        },
        defaultSongBackgroundBrightness:
          preferences.defaultSongBackgroundBrightness ||
          initialState.preferences.defaultSongBackgroundBrightness,
        defaultTimerBackgroundBrightness:
          preferences.defaultTimerBackgroundBrightness ||
          initialState.preferences.defaultTimerBackgroundBrightness,
        defaultBibleBackgroundBrightness:
          preferences.defaultBibleBackgroundBrightness ||
          initialState.preferences.defaultBibleBackgroundBrightness,
        defaultFreeFormBackgroundBrightness:
          preferences.defaultFreeFormBackgroundBrightness ||
          initialState.preferences.defaultFreeFormBackgroundBrightness,
        defaultSlidesPerRow:
          preferences.defaultSlidesPerRow ||
          initialState.preferences.defaultSlidesPerRow,
        defaultSlidesPerRowMobile:
          preferences.defaultSlidesPerRowMobile ||
          initialState.preferences.defaultSlidesPerRowMobile,
        defaultSlidesPerRowMusic:
          preferences.defaultSlidesPerRowMusic ||
          initialState.preferences.defaultSlidesPerRowMusic,
        defaultSlidesPerRowMusicMobile:
          preferences.defaultSlidesPerRowMusicMobile ||
          initialState.preferences.defaultSlidesPerRowMusicMobile,
        defaultFormattedLyricsPerRow:
          preferences.defaultFormattedLyricsPerRow ||
          initialState.preferences.defaultFormattedLyricsPerRow,
        defaultMediaItemsPerRow:
          preferences.defaultMediaItemsPerRow ||
          initialState.preferences.defaultMediaItemsPerRow,
        defaultShouldShowItemEditor:
          preferences.defaultShouldShowItemEditor ||
          initialState.preferences.defaultShouldShowItemEditor,
        defaultIsMediaExpanded:
          preferences.defaultIsMediaExpanded ||
          initialState.preferences.defaultIsMediaExpanded,
        defaultBibleFontMode:
          preferences.defaultBibleFontMode ||
          initialState.preferences.defaultBibleFontMode,
      };

      state.slidesPerRow =
        (isMusic
          ? preferences.defaultSlidesPerRowMusic
          : preferences.defaultSlidesPerRow) || initialState.slidesPerRow;
      state.slidesPerRowMobile =
        (isMusic
          ? preferences.defaultSlidesPerRowMusicMobile
          : preferences.defaultSlidesPerRowMobile) ||
        initialState.slidesPerRowMobile;
      state.formattedLyricsPerRow = preferences.defaultFormattedLyricsPerRow;
      state.mediaItemsPerRow = preferences.defaultMediaItemsPerRow;
      state.shouldShowItemEditor = preferences.defaultShouldShowItemEditor;
      state.isMediaExpanded = preferences.defaultIsMediaExpanded;
      state.bibleFontMode = preferences.defaultBibleFontMode;
      state.isInitialized = true;
    },

    updatePreferencesFromRemote: (
      state,
      action: PayloadAction<DBPreferences>
    ) => {
      state.preferences = {
        ...state.preferences,
        ...action.payload.preferences,
      };
      state.quickLinks = action.payload.quickLinks;
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
    setShouldShowStreamFormat: (state, action: PayloadAction<boolean>) => {
      state.shouldShowStreamFormat = action.payload;
    },
    setIsMediaExpanded: (state, action: PayloadAction<boolean>) => {
      state.isMediaExpanded = action.payload;
    },
    setIsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setBibleFontMode: (state, action: PayloadAction<BibleFontMode>) => {
      state.bibleFontMode = action.payload;
    },
    setScrollbarWidth: (state, action: PayloadAction<ScrollbarWidth>) => {
      state.scrollbarWidth = action.payload;
    },
    setSelectedPreference: (
      state,
      action: PayloadAction<SelectedPreferenceType>
    ) => {
      state.selectedPreference = action.payload;
    },

    // Monitor Settings

    initiateMonitorSettings: (
      state,
      action: PayloadAction<MonitorSettingsType>
    ) => {
      state.monitorSettings = {
        showClock:
          action.payload.showClock || initialState.monitorSettings.showClock,
        showTimer:
          action.payload.showTimer || initialState.monitorSettings.showTimer,
        clockFontSize:
          action.payload.clockFontSize ||
          initialState.monitorSettings.clockFontSize,
        timerFontSize:
          action.payload.timerFontSize ||
          initialState.monitorSettings.timerFontSize,
        timerId: action.payload.timerId || initialState.monitorSettings.timerId,
      };
    },

    setMonitorShowClock: (state, action: PayloadAction<boolean>) => {
      state.monitorSettings.showClock = action.payload;
    },
    setMonitorShowTimer: (state, action: PayloadAction<boolean>) => {
      state.monitorSettings.showTimer = action.payload;
    },
    setMonitorClockFontSize: (state, action: PayloadAction<number>) => {
      state.monitorSettings.clockFontSize = Math.min(
        Math.max(action.payload, 12),
        30
      );
    },
    setMonitorTimerFontSize: (state, action: PayloadAction<number>) => {
      state.monitorSettings.timerFontSize = Math.min(
        Math.max(action.payload, 12),
        30
      );
    },
    setMonitorTimerId: (state, action: PayloadAction<string | null>) => {
      state.monitorSettings.timerId = action.payload;
    },
    forceUpdate: () => {},
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
  setDefaultSlidesPerRowMusic,
  setDefaultSlidesPerRowMusicMobile,
  setDefaultFormattedLyricsPerRow,
  setDefaultMediaItemsPerRow,
  setQuickLinks,
  initiateQuickLinks,
  setSelectedQuickLink,
  setSelectedQuickLinkImage,
  setSelectedQuickLinkPresentation,
  setTab,
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
  setShouldShowStreamFormat,
  setIsMediaExpanded,
  increaseMediaItems,
  decreaseMediaItems,
  setMediaItems,
  setIsLoading,
  setSelectedPreference,
  setBibleFontMode,
  setScrollbarWidth,
  initiateMonitorSettings,
  setMonitorShowClock,
  setMonitorShowTimer,
  setMonitorClockFontSize,
  setMonitorTimerFontSize,
  setMonitorTimerId,
  updatePreferencesFromRemote,
  forceUpdate,
} = preferencesSlice.actions;

export default preferencesSlice.reducer;
