import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  BibleFontMode,
  PreferencesType,
  MonitorSettingsType,
  ScrollbarWidth,
  Presentation,
  QuickLinkType,
  MEDIA_ROUTE_FOLDERS_POUCH_ID,
  MONITOR_SETTINGS_POUCH_ID,
  PREFERENCES_POUCH_ID,
  PreferencesClusterRemoteDoc,
  QUICK_LINKS_POUCH_ID,
  MediaType,
  MediaRouteKey,
} from "../types";
import generateRandomId from "../utils/generateRandomId";
import { migrateLegacyMediaRouteFolders } from "../utils/mediaRouteKey";

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
  | "defaultFreeFormFontMode"
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
  toolbarSection: string;
  isMediaExpanded: boolean;
  quickLinks: QuickLinkType[];
  defaultQuickLinks: QuickLinkType[];
  selectedQuickLink: QuickLinkType | null;
  tab: PreferencesTabType;
  bibleFontMode: BibleFontMode;
  scrollbarWidth: ScrollbarWidth;
  isInitialized: boolean;
  /** Overlay controller main column: overlays list vs embedded credits editor (not persisted). */
  overlayControllerPanel: "overlays" | "credits";
  /** Last-selected media library folder per controller route; `null` = All media */
  mediaRouteFolders: Partial<Record<MediaRouteKey, string | null>>;
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
    defaultSlidesPerRowMusic: 6,
    defaultSlidesPerRowMusicMobile: 3,
    defaultFormattedLyricsPerRow: 4,
    defaultMediaItemsPerRow: 4,
    defaultShouldShowItemEditor: true,
    defaultIsMediaExpanded: false,
    defaultBibleFontMode: "separate",
    defaultFreeFormFontMode: "separate",
  },
  monitorSettings: {
    showClock: true,
    showTimer: true,
    showNextSlide: false,
    clockFontSize: 75,
    timerFontSize: 75,
    timerId: null,
  },
  slidesPerRow: 4,
  slidesPerRowMobile: 3,
  formattedLyricsPerRow: 4,
  mediaItemsPerRow: 4,
  shouldShowItemEditor: true,
  isMediaExpanded: false,
  shouldShowStreamFormat: false,
  toolbarSection: "settings",
  isLoading: true,
  selectedPreference: "",
  defaultQuickLinks: [],
  quickLinks: [],
  selectedQuickLink: null,
  tab: "defaults",
  bibleFontMode: "separate",
  scrollbarWidth: "thin",
  isInitialized: false,
  overlayControllerPanel: "overlays",
  mediaRouteFolders: {},
};

/** Defaults when `loadPreferencesBundle` fails so controller surfaces can finish init. */
export const preferencesClusterLoadFallback = {
  preferences: initialState.preferences,
  quickLinks: initialState.quickLinks,
  monitorSettings: initialState.monitorSettings,
  mediaRouteFolders: initialState.mediaRouteFolders,
};

export const preferencesSlice = createSlice({
  name: "preferences",
  initialState,
  reducers: {
    // Set Default Preferences

    setDefaultPreferences: (
      state,
      action: PayloadAction<Partial<PreferencesType>>,
    ) => {
      state.preferences = { ...state.preferences, ...action.payload };
    },
    setDefaultSongBackgroundBrightness: (
      state,
      action: PayloadAction<number>,
    ) => {
      state.preferences.defaultSongBackgroundBrightness = Math.min(
        Math.max(action.payload, 10),
        100,
      );
    },
    setDefaultTimerBackgroundBrightness: (
      state,
      action: PayloadAction<number>,
    ) => {
      state.preferences.defaultTimerBackgroundBrightness = Math.min(
        Math.max(action.payload, 10),
        100,
      );
    },
    setDefaultBibleBackgroundBrightness: (
      state,
      action: PayloadAction<number>,
    ) => {
      state.preferences.defaultBibleBackgroundBrightness = Math.min(
        Math.max(action.payload, 10),
        100,
      );
    },
    setDefaultFreeFormBackgroundBrightness: (
      state,
      action: PayloadAction<number>,
    ) => {
      state.preferences.defaultFreeFormBackgroundBrightness = Math.min(
        Math.max(action.payload, 10),
        100,
      );
    },
    setDefaultSlidesPerRow: (state, action: PayloadAction<number>) => {
      state.preferences.defaultSlidesPerRow = Math.min(
        Math.max(action.payload, 1),
        7,
      );
    },
    setDefaultSlidesPerRowMobile: (state, action: PayloadAction<number>) => {
      state.preferences.defaultSlidesPerRowMobile = Math.min(
        Math.max(action.payload, 1),
        7,
      );
    },
    setDefaultSlidesPerRowMusic: (state, action: PayloadAction<number>) => {
      state.preferences.defaultSlidesPerRowMusic = Math.min(
        Math.max(action.payload, 1),
        7,
      );
    },
    setDefaultSlidesPerRowMusicMobile: (
      state,
      action: PayloadAction<number>,
    ) => {
      state.preferences.defaultSlidesPerRowMusicMobile = Math.min(
        Math.max(action.payload, 1),
        7,
      );
    },
    setDefaultFormattedLyricsPerRow: (state, action: PayloadAction<number>) => {
      state.preferences.defaultFormattedLyricsPerRow = Math.min(
        Math.max(action.payload, 1),
        4,
      );
    },
    setDefaultMediaItemsPerRow: (state, action: PayloadAction<number>) => {
      state.preferences.defaultMediaItemsPerRow = Math.min(
        Math.max(action.payload, 1),
        7,
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
      action: PayloadAction<Presentation>,
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

    setMediaRouteFolder: (
      state,
      action: PayloadAction<{ key: MediaRouteKey; folderId: string | null }>,
    ) => {
      state.mediaRouteFolders = {
        ...state.mediaRouteFolders,
        [action.payload.key]: action.payload.folderId,
      };
    },

    initiatePreferences: (
      state,
      action: PayloadAction<{
        preferences: PreferencesType;
        isMusic: boolean;
        mediaRouteFolders?: Partial<Record<MediaRouteKey, string | null>>;
      }>,
    ) => {
      const { preferences, isMusic, mediaRouteFolders } = action.payload;

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
        defaultFreeFormFontMode:
          preferences.defaultFreeFormFontMode ||
          initialState.preferences.defaultFreeFormFontMode,
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
      state.mediaRouteFolders = migrateLegacyMediaRouteFolders(
        mediaRouteFolders ?? {},
      );
    },

    updatePreferencesFromRemote: (
      state,
      action: PayloadAction<PreferencesClusterRemoteDoc>,
    ) => {
      const d = action.payload;
      if (d._id === PREFERENCES_POUCH_ID) {
        state.preferences = {
          ...state.preferences,
          ...d.preferences,
        };
      } else if (d._id === QUICK_LINKS_POUCH_ID) {
        state.quickLinks = d.quickLinks;
      } else if (d._id === MONITOR_SETTINGS_POUCH_ID) {
        state.monitorSettings = {
          showClock:
            d.monitorSettings.showClock ??
            initialState.monitorSettings.showClock,
          showTimer:
            d.monitorSettings.showTimer ??
            initialState.monitorSettings.showTimer,
          showNextSlide:
            d.monitorSettings.showNextSlide ??
            initialState.monitorSettings.showNextSlide,
          clockFontSize:
            d.monitorSettings.clockFontSize ??
            initialState.monitorSettings.clockFontSize,
          timerFontSize:
            d.monitorSettings.timerFontSize ??
            initialState.monitorSettings.timerFontSize,
          timerId:
            d.monitorSettings.timerId ?? initialState.monitorSettings.timerId,
        };
      } else if (d._id === MEDIA_ROUTE_FOLDERS_POUCH_ID) {
        state.mediaRouteFolders = migrateLegacyMediaRouteFolders(
          d.mediaRouteFolders,
        );
      }
    },

    // Temporary Preferences Below

    increaseSlides: (state) => {
      state.slidesPerRow = Math.min((state.slidesPerRow || 4) + 1, 7);
    },
    increaseSlidesMobile: (state) => {
      state.slidesPerRowMobile = Math.min(
        (state.slidesPerRowMobile || 4) + 1,
        7,
      );
    },
    decreaseSlides: (state) => {
      state.slidesPerRow = Math.max((state.slidesPerRow || 3) - 1, 1);
    },
    decreaseSlidesMobile: (state) => {
      state.slidesPerRowMobile = Math.max(
        (state.slidesPerRowMobile || 3) - 1,
        1,
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
        6,
      );
    },
    decreaseFormattedLyrics: (state) => {
      state.formattedLyricsPerRow = Math.max(
        (state.formattedLyricsPerRow || 3) - 1,
        1,
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
    setToolbarSection: (state, action: PayloadAction<string>) => {
      state.toolbarSection = action.payload;
    },
    setOverlayControllerPanel: (
      state,
      action: PayloadAction<"overlays" | "credits">,
    ) => {
      state.overlayControllerPanel = action.payload;
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
      action: PayloadAction<SelectedPreferenceType>,
    ) => {
      state.selectedPreference = action.payload;
    },
    setIsInitialized: (state, action: PayloadAction<boolean>) => {
      state.isInitialized = action.payload;
    },
    // Monitor Settings

    initiateMonitorSettings: (
      state,
      action: PayloadAction<MonitorSettingsType>,
    ) => {
      state.monitorSettings = {
        showClock:
          action.payload.showClock ?? initialState.monitorSettings.showClock,
        showTimer:
          action.payload.showTimer ?? initialState.monitorSettings.showTimer,
        showNextSlide:
          action.payload.showNextSlide ??
          initialState.monitorSettings.showNextSlide,
        clockFontSize:
          action.payload.clockFontSize ??
          initialState.monitorSettings.clockFontSize,
        timerFontSize:
          action.payload.timerFontSize ??
          initialState.monitorSettings.timerFontSize,
        timerId: action.payload.timerId ?? initialState.monitorSettings.timerId,
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
        Math.max(action.payload, 75),
        115,
      );
    },
    setMonitorTimerFontSize: (state, action: PayloadAction<number>) => {
      state.monitorSettings.timerFontSize = Math.min(
        Math.max(action.payload, 75),
        115,
      );
    },
    setMonitorTimerId: (state, action: PayloadAction<string | null>) => {
      state.monitorSettings.timerId = action.payload;
    },
    setMonitorShowNextSlide: (state, action: PayloadAction<boolean>) => {
      state.monitorSettings.showNextSlide = action.payload;
    },
    forceUpdate: () => {},
  },
});

export const {
  setMediaRouteFolder,
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
  setToolbarSection,
  setOverlayControllerPanel,
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
  setMonitorShowNextSlide,
  updatePreferencesFromRemote,
  forceUpdate,
  setIsInitialized,
} = preferencesSlice.actions;

export default preferencesSlice.reducer;
