import { configureStore } from "@reduxjs/toolkit";
import { preferencesSlice } from "./preferencesSlice";
import type { PreferencesTabType } from "./preferencesSlice";

jest.mock("../utils/generateRandomId", () => ({
  __esModule: true,
  default: () => "fixed-pref-id",
}));

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

describe("preferencesSlice", () => {
  describe("reducer only", () => {
    it("setTab sets tab", () => {
      const store = createStore();
      store.dispatch(
        preferencesSlice.actions.setTab("quickLinks" as PreferencesTabType),
      );
      expect(store.getState().preferences.tab).toBe("quickLinks");
    });

    it("setSlides and setSlidesMobile update state", () => {
      const store = createStore();
      store.dispatch(preferencesSlice.actions.setSlides(3));
      store.dispatch(preferencesSlice.actions.setSlidesMobile(2));
      expect(store.getState().preferences.slidesPerRow).toBe(3);
      expect(store.getState().preferences.slidesPerRowMobile).toBe(2);
    });

    it("setShouldShowItemEditor sets shouldShowItemEditor", () => {
      const store = createStore();
      store.dispatch(preferencesSlice.actions.setShouldShowItemEditor(false));
      expect(store.getState().preferences.shouldShowItemEditor).toBe(false);
    });

    it("setQuickLinks replaces quickLinks", () => {
      const store = createStore();
      const links = [{ id: "l1", label: "Link 1", canDelete: true }];
      store.dispatch(preferencesSlice.actions.setQuickLinks(links));
      expect(store.getState().preferences.quickLinks).toHaveLength(1);
      expect(store.getState().preferences.quickLinks[0].label).toBe("Link 1");
    });

    it("setDefaultSongBackgroundBrightness clamps between 10 and 100", () => {
      const store = createStore();
      store.dispatch(
        preferencesSlice.actions.setDefaultSongBackgroundBrightness(50),
      );
      expect(
        store.getState().preferences.preferences
          .defaultSongBackgroundBrightness,
      ).toBe(50);
      store.dispatch(
        preferencesSlice.actions.setDefaultSongBackgroundBrightness(200),
      );
      expect(
        store.getState().preferences.preferences
          .defaultSongBackgroundBrightness,
      ).toBe(100);
      store.dispatch(
        preferencesSlice.actions.setDefaultSongBackgroundBrightness(0),
      );
      expect(
        store.getState().preferences.preferences
          .defaultSongBackgroundBrightness,
      ).toBe(10);
    });
  });
});
