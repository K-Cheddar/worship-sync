import { configureStore } from "@reduxjs/toolkit";
import { preferencesSlice } from "./preferencesSlice";
import type {
  ControllerConfigurationRoute,
  PreferencesTabType,
} from "./preferencesSlice";
import {
  PREFERENCES_POUCH_ID,
  QUICK_LINKS_POUCH_ID,
  MONITOR_SETTINGS_POUCH_ID,
  MEDIA_ROUTE_FOLDERS_POUCH_ID,
} from "../types";

jest.mock("../utils/generateRandomId", () => ({
  __esModule: true,
  default: () => "fixed-pref-id",
}));

const {
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
  setLastControllerConfigurationRoute,
  setOverlayControllerPanel,
  setOverlayCreditsSettingsDrawerOpen,
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
  setFocusMediaId,
  setRequestOpenMediaPanel,
  setMediaRouteFolder,
} = preferencesSlice.actions;

type PreferencesState = ReturnType<typeof preferencesSlice.reducer>;
type PreferencesSliceState = { preferences: PreferencesState };

const createStore = (preloadedState?: Partial<PreferencesSliceState>) =>
  configureStore({
    reducer: { preferences: preferencesSlice.reducer },
    ...(preloadedState != null &&
      Object.keys(preloadedState).length > 0 && {
        preloadedState: preloadedState as PreferencesSliceState,
      }),
  });

const makeQuickLink = (id: string, label: string) => ({
  id,
  label,
  presentationInfo: null,
});

describe("preferencesSlice", () => {
  describe("initial state", () => {
    it("starts with expected defaults", () => {
      const store = createStore();
      const state = store.getState().preferences;
      expect(state.isLoading).toBe(true);
      expect(state.isInitialized).toBe(false);
      expect(state.slidesPerRow).toBe(4);
      expect(state.bibleFontMode).toBe("separate");
      expect(state.overlayControllerPanel).toBe("overlays");
      expect(state.focusMediaId).toBeNull();
      expect(state.requestOpenMediaPanel).toBe(false);
    });
  });

  describe("reducer only", () => {
    it("setTab sets tab", () => {
      const store = createStore();
      store.dispatch(setTab("quickLinks" as PreferencesTabType));
      expect(store.getState().preferences.tab).toBe("quickLinks");
    });

    it("setSlides and setSlidesMobile update state", () => {
      const store = createStore();
      store.dispatch(setSlides(3));
      store.dispatch(setSlidesMobile(2));
      expect(store.getState().preferences.slidesPerRow).toBe(3);
      expect(store.getState().preferences.slidesPerRowMobile).toBe(2);
    });

    it("setShouldShowItemEditor sets shouldShowItemEditor", () => {
      const store = createStore();
      store.dispatch(setShouldShowItemEditor(false));
      expect(store.getState().preferences.shouldShowItemEditor).toBe(false);
    });

    it("setLastControllerConfigurationRoute updates the remembered controller tab", () => {
      const store = createStore();
      store.dispatch(
        setLastControllerConfigurationRoute(
          "/controller/service-planning" as ControllerConfigurationRoute,
        ),
      );
      expect(
        store.getState().preferences.lastControllerConfigurationRoute,
      ).toBe("/controller/service-planning");
    });

    it("setQuickLinks replaces quickLinks", () => {
      const store = createStore();
      const links = [{ id: "l1", label: "Link 1", canDelete: true }];
      store.dispatch(setQuickLinks(links));
      expect(store.getState().preferences.quickLinks).toHaveLength(1);
      expect(store.getState().preferences.quickLinks[0].label).toBe("Link 1");
    });

    it("setDefaultSongBackgroundBrightness clamps between 10 and 100", () => {
      const store = createStore();
      store.dispatch(setDefaultSongBackgroundBrightness(50));
      expect(
        store.getState().preferences.preferences.defaultSongBackgroundBrightness,
      ).toBe(50);
      store.dispatch(setDefaultSongBackgroundBrightness(200));
      expect(
        store.getState().preferences.preferences.defaultSongBackgroundBrightness,
      ).toBe(100);
      store.dispatch(setDefaultSongBackgroundBrightness(0));
      expect(
        store.getState().preferences.preferences.defaultSongBackgroundBrightness,
      ).toBe(10);
    });
  });

  describe("brightness setters (clamped 10–100)", () => {
    it("setDefaultTimerBackgroundBrightness clamps to 10–100", () => {
      const store = createStore();
      store.dispatch(setDefaultTimerBackgroundBrightness(5));
      expect(
        store.getState().preferences.preferences.defaultTimerBackgroundBrightness,
      ).toBe(10);
      store.dispatch(setDefaultTimerBackgroundBrightness(110));
      expect(
        store.getState().preferences.preferences.defaultTimerBackgroundBrightness,
      ).toBe(100);
      store.dispatch(setDefaultTimerBackgroundBrightness(75));
      expect(
        store.getState().preferences.preferences.defaultTimerBackgroundBrightness,
      ).toBe(75);
    });

    it("setDefaultBibleBackgroundBrightness clamps to 10–100", () => {
      const store = createStore();
      store.dispatch(setDefaultBibleBackgroundBrightness(5));
      expect(
        store.getState().preferences.preferences.defaultBibleBackgroundBrightness,
      ).toBe(10);
      store.dispatch(setDefaultBibleBackgroundBrightness(110));
      expect(
        store.getState().preferences.preferences.defaultBibleBackgroundBrightness,
      ).toBe(100);
    });

    it("setDefaultFreeFormBackgroundBrightness clamps to 10–100", () => {
      const store = createStore();
      store.dispatch(setDefaultFreeFormBackgroundBrightness(3));
      expect(
        store.getState().preferences.preferences.defaultFreeFormBackgroundBrightness,
      ).toBe(10);
      store.dispatch(setDefaultFreeFormBackgroundBrightness(150));
      expect(
        store.getState().preferences.preferences.defaultFreeFormBackgroundBrightness,
      ).toBe(100);
    });
  });

  describe("slides-per-row setters (clamped 1–7)", () => {
    it("setDefaultSlidesPerRow clamps to 1–7", () => {
      const store = createStore();
      store.dispatch(setDefaultSlidesPerRow(0));
      expect(
        store.getState().preferences.preferences.defaultSlidesPerRow,
      ).toBe(1);
      store.dispatch(setDefaultSlidesPerRow(10));
      expect(
        store.getState().preferences.preferences.defaultSlidesPerRow,
      ).toBe(7);
      store.dispatch(setDefaultSlidesPerRow(5));
      expect(
        store.getState().preferences.preferences.defaultSlidesPerRow,
      ).toBe(5);
    });

    it("setDefaultSlidesPerRowMobile clamps to 1–7", () => {
      const store = createStore();
      store.dispatch(setDefaultSlidesPerRowMobile(0));
      expect(
        store.getState().preferences.preferences.defaultSlidesPerRowMobile,
      ).toBe(1);
    });

    it("setDefaultSlidesPerRowMusic clamps to 1–7", () => {
      const store = createStore();
      store.dispatch(setDefaultSlidesPerRowMusic(8));
      expect(
        store.getState().preferences.preferences.defaultSlidesPerRowMusic,
      ).toBe(7);
    });

    it("setDefaultSlidesPerRowMusicMobile clamps to 1–7", () => {
      const store = createStore();
      store.dispatch(setDefaultSlidesPerRowMusicMobile(0));
      expect(
        store.getState().preferences.preferences.defaultSlidesPerRowMusicMobile,
      ).toBe(1);
    });

    it("setDefaultFormattedLyricsPerRow clamps to 1–4", () => {
      const store = createStore();
      store.dispatch(setDefaultFormattedLyricsPerRow(5));
      expect(
        store.getState().preferences.preferences.defaultFormattedLyricsPerRow,
      ).toBe(4);
      store.dispatch(setDefaultFormattedLyricsPerRow(0));
      expect(
        store.getState().preferences.preferences.defaultFormattedLyricsPerRow,
      ).toBe(1);
    });

    it("setDefaultMediaItemsPerRow clamps to 1–7", () => {
      const store = createStore();
      store.dispatch(setDefaultMediaItemsPerRow(8));
      expect(
        store.getState().preferences.preferences.defaultMediaItemsPerRow,
      ).toBe(7);
      store.dispatch(setDefaultMediaItemsPerRow(0));
      expect(
        store.getState().preferences.preferences.defaultMediaItemsPerRow,
      ).toBe(1);
    });
  });

  describe("setDefaultPreferences", () => {
    it("merges partial preferences without overwriting others", () => {
      const store = createStore();
      store.dispatch(setDefaultPreferences({ defaultSlidesPerRow: 6 } as any));
      expect(
        store.getState().preferences.preferences.defaultSlidesPerRow,
      ).toBe(6);
      expect(
        store.getState().preferences.preferences.defaultBibleBackgroundBrightness,
      ).toBe(60);
    });
  });

  describe("quick links", () => {
    it("initiateQuickLinks sets list", () => {
      const store = createStore();
      store.dispatch(initiateQuickLinks([makeQuickLink("q1", "Link 1")] as any));
      expect(store.getState().preferences.quickLinks).toHaveLength(1);
    });

    it("setSelectedQuickLink finds quick link by id", () => {
      const store = createStore();
      const links = [makeQuickLink("q1", "Link 1"), makeQuickLink("q2", "Link 2")];
      store.dispatch(setQuickLinks(links as any));
      store.dispatch(setSelectedQuickLink("q1"));
      expect(store.getState().preferences.selectedQuickLink?.id).toBe("q1");
    });

    it("setSelectedQuickLink sets null when id not found", () => {
      const store = createStore();
      store.dispatch(setSelectedQuickLink("nonexistent"));
      expect(store.getState().preferences.selectedQuickLink).toBeNull();
    });
  });

  describe("slide count controls (temporary)", () => {
    it("increaseSlides increments slidesPerRow up to 7", () => {
      const store = createStore();
      store.dispatch(setSlides(6));
      store.dispatch(increaseSlides());
      expect(store.getState().preferences.slidesPerRow).toBe(7);
      store.dispatch(increaseSlides());
      expect(store.getState().preferences.slidesPerRow).toBe(7);
    });

    it("decreaseSlides decrements slidesPerRow down to 1", () => {
      const store = createStore();
      store.dispatch(setSlides(2));
      store.dispatch(decreaseSlides());
      expect(store.getState().preferences.slidesPerRow).toBe(1);
      store.dispatch(decreaseSlides());
      expect(store.getState().preferences.slidesPerRow).toBe(1);
    });

    it("increaseSlidesMobile caps at 7", () => {
      const store = createStore();
      store.dispatch(setSlidesMobile(7));
      store.dispatch(increaseSlidesMobile());
      expect(store.getState().preferences.slidesPerRowMobile).toBe(7);
    });

    it("decreaseSlidesMobile floors at 1", () => {
      const store = createStore();
      store.dispatch(setSlidesMobile(1));
      store.dispatch(decreaseSlidesMobile());
      expect(store.getState().preferences.slidesPerRowMobile).toBe(1);
    });

    it("increaseFormattedLyrics caps at 6", () => {
      const store = createStore();
      store.dispatch(setFormattedLyrics(6));
      store.dispatch(increaseFormattedLyrics());
      expect(store.getState().preferences.formattedLyricsPerRow).toBe(6);
    });

    it("decreaseFormattedLyrics floors at 1", () => {
      const store = createStore();
      store.dispatch(setFormattedLyrics(1));
      store.dispatch(decreaseFormattedLyrics());
      expect(store.getState().preferences.formattedLyricsPerRow).toBe(1);
    });

    it("increaseMediaItems caps at 7", () => {
      const store = createStore();
      store.dispatch(setMediaItems(7));
      store.dispatch(increaseMediaItems());
      expect(store.getState().preferences.mediaItemsPerRow).toBe(7);
    });

    it("decreaseMediaItems floors at 2", () => {
      const store = createStore();
      store.dispatch(setMediaItems(2));
      store.dispatch(decreaseMediaItems());
      expect(store.getState().preferences.mediaItemsPerRow).toBe(2);
    });
  });

  describe("flag setters", () => {
    it("setShouldShowStreamFormat", () => {
      const store = createStore();
      store.dispatch(setShouldShowStreamFormat(true));
      expect(store.getState().preferences.shouldShowStreamFormat).toBe(true);
    });

    it("setToolbarSection", () => {
      const store = createStore();
      store.dispatch(setToolbarSection("media"));
      expect(store.getState().preferences.toolbarSection).toBe("media");
    });

    it("setIsMediaExpanded", () => {
      const store = createStore();
      store.dispatch(setIsMediaExpanded(true));
      expect(store.getState().preferences.isMediaExpanded).toBe(true);
    });

    it("setIsLoading", () => {
      const store = createStore();
      store.dispatch(setIsLoading(false));
      expect(store.getState().preferences.isLoading).toBe(false);
    });

    it("setIsInitialized", () => {
      const store = createStore();
      store.dispatch(setIsInitialized(true));
      expect(store.getState().preferences.isInitialized).toBe(true);
    });

    it("setBibleFontMode", () => {
      const store = createStore();
      store.dispatch(setBibleFontMode("combined"));
      expect(store.getState().preferences.bibleFontMode).toBe("combined");
    });

    it("setScrollbarWidth", () => {
      const store = createStore();
      store.dispatch(setScrollbarWidth("auto"));
      expect(store.getState().preferences.scrollbarWidth).toBe("auto");
    });

    it("setSelectedPreference", () => {
      const store = createStore();
      store.dispatch(setSelectedPreference("defaultSongBackground"));
      expect(store.getState().preferences.selectedPreference).toBe(
        "defaultSongBackground",
      );
    });

    it("setFocusMediaId sets and clears", () => {
      const store = createStore();
      store.dispatch(setFocusMediaId("media-123"));
      expect(store.getState().preferences.focusMediaId).toBe("media-123");
      store.dispatch(setFocusMediaId(null));
      expect(store.getState().preferences.focusMediaId).toBeNull();
    });

    it("setRequestOpenMediaPanel", () => {
      const store = createStore();
      store.dispatch(setRequestOpenMediaPanel(true));
      expect(store.getState().preferences.requestOpenMediaPanel).toBe(true);
    });

    it("forceUpdate is a no-op that does not throw", () => {
      const store = createStore();
      expect(() => store.dispatch(forceUpdate())).not.toThrow();
    });
  });

  describe("setOverlayControllerPanel", () => {
    it("clears credits drawer when switching away from credits", () => {
      const store = createStore();
      store.dispatch(setOverlayCreditsSettingsDrawerOpen(true));
      store.dispatch(setOverlayControllerPanel("overlays"));
      expect(store.getState().preferences.overlayControllerPanel).toBe("overlays");
      expect(
        store.getState().preferences.overlayCreditsSettingsDrawerOpen,
      ).toBe(false);
    });

    it("preserves credits drawer when switching to credits", () => {
      const store = createStore();
      store.dispatch(setOverlayCreditsSettingsDrawerOpen(true));
      store.dispatch(setOverlayControllerPanel("credits"));
      expect(
        store.getState().preferences.overlayCreditsSettingsDrawerOpen,
      ).toBe(true);
    });

    it("setOverlayCreditsSettingsDrawerOpen toggles", () => {
      const store = createStore();
      store.dispatch(setOverlayCreditsSettingsDrawerOpen(true));
      expect(
        store.getState().preferences.overlayCreditsSettingsDrawerOpen,
      ).toBe(true);
    });
  });

  describe("setMediaRouteFolder", () => {
    it("sets a media route folder by key", () => {
      const store = createStore();
      store.dispatch(
        setMediaRouteFolder({ key: "image", folderId: "folder-123" }),
      );
      expect(store.getState().preferences.mediaRouteFolders.image).toBe(
        "folder-123",
      );
    });

    it("allows setting a folder to null (all media)", () => {
      const store = createStore();
      store.dispatch(setMediaRouteFolder({ key: "image", folderId: null }));
      expect(store.getState().preferences.mediaRouteFolders.image).toBeNull();
    });
  });

  describe("initiatePreferences", () => {
    const basePrefs = {
      defaultSongBackground: { background: "bg.jpg", mediaInfo: undefined },
      defaultTimerBackground: { background: "", mediaInfo: undefined },
      defaultBibleBackground: { background: "bible.jpg", mediaInfo: undefined },
      defaultFreeFormBackground: { background: "free.jpg", mediaInfo: undefined },
      defaultSongBackgroundBrightness: 70,
      defaultTimerBackgroundBrightness: 75,
      defaultBibleBackgroundBrightness: 60,
      defaultFreeFormBackgroundBrightness: 100,
      defaultSlidesPerRow: 5,
      defaultSlidesPerRowMobile: 3,
      defaultSlidesPerRowMusic: 6,
      defaultSlidesPerRowMusicMobile: 4,
      defaultFormattedLyricsPerRow: 4,
      defaultMediaItemsPerRow: 4,
      defaultShouldShowItemEditor: true,
      defaultIsMediaExpanded: false,
      defaultBibleFontMode: "separate" as const,
      defaultFreeFormFontMode: "separate" as const,
    };

    it("derives slidesPerRow from non-music context", () => {
      const store = createStore();
      store.dispatch(initiatePreferences({ preferences: basePrefs, isMusic: false }));
      expect(store.getState().preferences.slidesPerRow).toBe(5);
      expect(store.getState().preferences.slidesPerRowMobile).toBe(3);
    });

    it("uses music slides per row in music context", () => {
      const store = createStore();
      store.dispatch(initiatePreferences({ preferences: basePrefs, isMusic: true }));
      expect(store.getState().preferences.slidesPerRow).toBe(6);
      expect(store.getState().preferences.slidesPerRowMobile).toBe(4);
    });

    it("sets bibleFontMode from preferences", () => {
      const store = createStore();
      store.dispatch(
        initiatePreferences({
          preferences: { ...basePrefs, defaultBibleFontMode: "combined" },
          isMusic: false,
        }),
      );
      expect(store.getState().preferences.bibleFontMode).toBe("combined");
    });
  });

  describe("monitor settings", () => {
    it("initiateMonitorSettings applies provided values", () => {
      const store = createStore();
      store.dispatch(
        initiateMonitorSettings({
          showClock: false,
          showTimer: false,
          showNextSlide: true,
          clockFontSize: 90,
          timerFontSize: 80,
          timerId: "timer-1",
        }),
      );
      const ms = store.getState().preferences.monitorSettings;
      expect(ms.showClock).toBe(false);
      expect(ms.showNextSlide).toBe(true);
      expect(ms.clockFontSize).toBe(90);
      expect(ms.timerId).toBe("timer-1");
    });

    it("initiateMonitorSettings uses defaults for undefined fields", () => {
      const store = createStore();
      store.dispatch(initiateMonitorSettings({} as any));
      const ms = store.getState().preferences.monitorSettings;
      expect(ms.showClock).toBe(true);
      expect(ms.showTimer).toBe(true);
    });

    it("setMonitorShowClock toggles", () => {
      const store = createStore();
      store.dispatch(setMonitorShowClock(false));
      expect(store.getState().preferences.monitorSettings.showClock).toBe(false);
    });

    it("setMonitorShowTimer toggles", () => {
      const store = createStore();
      store.dispatch(setMonitorShowTimer(false));
      expect(store.getState().preferences.monitorSettings.showTimer).toBe(false);
    });

    it("setMonitorClockFontSize clamps to 75–115", () => {
      const store = createStore();
      store.dispatch(setMonitorClockFontSize(60));
      expect(
        store.getState().preferences.monitorSettings.clockFontSize,
      ).toBe(75);
      store.dispatch(setMonitorClockFontSize(120));
      expect(
        store.getState().preferences.monitorSettings.clockFontSize,
      ).toBe(115);
      store.dispatch(setMonitorClockFontSize(90));
      expect(
        store.getState().preferences.monitorSettings.clockFontSize,
      ).toBe(90);
    });

    it("setMonitorTimerFontSize clamps to 75–115", () => {
      const store = createStore();
      store.dispatch(setMonitorTimerFontSize(50));
      expect(
        store.getState().preferences.monitorSettings.timerFontSize,
      ).toBe(75);
      store.dispatch(setMonitorTimerFontSize(200));
      expect(
        store.getState().preferences.monitorSettings.timerFontSize,
      ).toBe(115);
    });

    it("setMonitorTimerId sets and clears", () => {
      const store = createStore();
      store.dispatch(setMonitorTimerId("t1"));
      expect(store.getState().preferences.monitorSettings.timerId).toBe("t1");
      store.dispatch(setMonitorTimerId(null));
      expect(store.getState().preferences.monitorSettings.timerId).toBeNull();
    });

    it("setMonitorShowNextSlide toggles", () => {
      const store = createStore();
      store.dispatch(setMonitorShowNextSlide(true));
      expect(
        store.getState().preferences.monitorSettings.showNextSlide,
      ).toBe(true);
    });
  });

  describe("updatePreferencesFromRemote", () => {
    it("merges preferences when _id is PREFERENCES_POUCH_ID", () => {
      const store = createStore();
      store.dispatch(
        updatePreferencesFromRemote({
          _id: PREFERENCES_POUCH_ID,
          preferences: { defaultSlidesPerRow: 6 } as any,
        } as any),
      );
      expect(
        store.getState().preferences.preferences.defaultSlidesPerRow,
      ).toBe(6);
    });

    it("replaces quickLinks when _id is QUICK_LINKS_POUCH_ID", () => {
      const store = createStore();
      store.dispatch(
        updatePreferencesFromRemote({
          _id: QUICK_LINKS_POUCH_ID,
          quickLinks: [makeQuickLink("q1", "Link 1")],
        } as any),
      );
      expect(store.getState().preferences.quickLinks).toHaveLength(1);
    });

    it("updates monitor settings when _id is MONITOR_SETTINGS_POUCH_ID", () => {
      const store = createStore();
      store.dispatch(
        updatePreferencesFromRemote({
          _id: MONITOR_SETTINGS_POUCH_ID,
          monitorSettings: {
            showClock: false,
            showTimer: true,
            showNextSlide: false,
            clockFontSize: 90,
            timerFontSize: 85,
            timerId: "t2",
          },
        } as any),
      );
      expect(store.getState().preferences.monitorSettings.showClock).toBe(false);
      expect(store.getState().preferences.monitorSettings.timerId).toBe("t2");
    });

    it("updates mediaRouteFolders when _id is MEDIA_ROUTE_FOLDERS_POUCH_ID", () => {
      const store = createStore();
      store.dispatch(
        updatePreferencesFromRemote({
          _id: MEDIA_ROUTE_FOLDERS_POUCH_ID,
          mediaRouteFolders: { image: "folder-1" },
        } as any),
      );
      expect(store.getState().preferences.mediaRouteFolders.image).toBe(
        "folder-1",
      );
    });

    it("does nothing for an unrecognized _id", () => {
      const store = createStore();
      const before =
        store.getState().preferences.preferences.defaultSlidesPerRow;
      store.dispatch(
        updatePreferencesFromRemote({ _id: "unknown-doc" } as any),
      );
      expect(
        store.getState().preferences.preferences.defaultSlidesPerRow,
      ).toBe(before);
    });
  });
});
