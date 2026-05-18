import { configureStore } from "@reduxjs/toolkit";
import {
  autosaveIndicatorSlice,
  AUTOSAVE_DEBOUNCE_KEYS,
} from "./autosaveIndicatorSlice";

const { beginKeyedDebouncedSave, endKeyedDebouncedSave } =
  autosaveIndicatorSlice.actions;

const createStore = () =>
  configureStore({
    reducer: { autosaveIndicator: autosaveIndicatorSlice.reducer },
  });

describe("autosaveIndicatorSlice", () => {
  describe("initial state", () => {
    it("starts with empty debouncedSaveDepth", () => {
      const store = createStore();
      expect(store.getState().autosaveIndicator.debouncedSaveDepth).toEqual({});
    });
  });

  describe("AUTOSAVE_DEBOUNCE_KEYS", () => {
    it("exports stable key constants for each tracked doc type", () => {
      expect(AUTOSAVE_DEBOUNCE_KEYS.credits).toBe("debounced/credits");
      expect(AUTOSAVE_DEBOUNCE_KEYS.media).toBe("debounced/media");
      expect(AUTOSAVE_DEBOUNCE_KEYS.preferences).toBe("debounced/preferences");
      expect(AUTOSAVE_DEBOUNCE_KEYS.serviceTimes).toBe("debounced/serviceTimes");
      expect(AUTOSAVE_DEBOUNCE_KEYS.itemLists).toBe("debounced/itemLists");
      expect(AUTOSAVE_DEBOUNCE_KEYS.allItems).toBe("debounced/allItems");
    });
  });

  describe("beginKeyedDebouncedSave", () => {
    it("initialises depth to 1 for a new key", () => {
      const store = createStore();
      store.dispatch(beginKeyedDebouncedSave("debounced/credits"));
      expect(
        store.getState().autosaveIndicator.debouncedSaveDepth["debounced/credits"],
      ).toBe(1);
    });

    it("increments depth on subsequent calls for the same key", () => {
      const store = createStore();
      store.dispatch(beginKeyedDebouncedSave("k"));
      store.dispatch(beginKeyedDebouncedSave("k"));
      expect(store.getState().autosaveIndicator.debouncedSaveDepth["k"]).toBe(2);
    });

    it("tracks multiple keys independently", () => {
      const store = createStore();
      store.dispatch(beginKeyedDebouncedSave("a"));
      store.dispatch(beginKeyedDebouncedSave("b"));
      store.dispatch(beginKeyedDebouncedSave("b"));
      expect(store.getState().autosaveIndicator.debouncedSaveDepth["a"]).toBe(1);
      expect(store.getState().autosaveIndicator.debouncedSaveDepth["b"]).toBe(2);
    });
  });

  describe("endKeyedDebouncedSave", () => {
    it("removes the key when depth reaches zero", () => {
      const store = createStore();
      store.dispatch(beginKeyedDebouncedSave("k"));
      store.dispatch(endKeyedDebouncedSave("k"));
      expect(
        store.getState().autosaveIndicator.debouncedSaveDepth["k"],
      ).toBeUndefined();
    });

    it("decrements depth without removing when depth stays above zero", () => {
      const store = createStore();
      store.dispatch(beginKeyedDebouncedSave("k"));
      store.dispatch(beginKeyedDebouncedSave("k"));
      store.dispatch(endKeyedDebouncedSave("k"));
      expect(store.getState().autosaveIndicator.debouncedSaveDepth["k"]).toBe(1);
    });

    it("removes the key when called on a missing key (depth would be <= 0)", () => {
      const store = createStore();
      store.dispatch(endKeyedDebouncedSave("nonexistent"));
      expect(
        store.getState().autosaveIndicator.debouncedSaveDepth["nonexistent"],
      ).toBeUndefined();
    });
  });
});
