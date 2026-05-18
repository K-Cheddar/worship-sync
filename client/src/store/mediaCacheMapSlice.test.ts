import { configureStore } from "@reduxjs/toolkit";
import mediaCacheMapReducer, { setMediaCacheMap } from "./mediaCacheMapSlice";

const createStore = () =>
  configureStore({ reducer: { mediaCacheMap: mediaCacheMapReducer } });

describe("mediaCacheMapSlice", () => {
  describe("initial state", () => {
    it("starts with an empty map", () => {
      const store = createStore();
      expect(store.getState().mediaCacheMap.map).toEqual({});
    });
  });

  describe("setMediaCacheMap", () => {
    it("replaces the map with the provided object", () => {
      const store = createStore();
      store.dispatch(setMediaCacheMap({ "url-a": "cached-a", "url-b": "cached-b" }));
      expect(store.getState().mediaCacheMap.map).toEqual({
        "url-a": "cached-a",
        "url-b": "cached-b",
      });
    });

    it("replaces a previously set map", () => {
      const store = createStore();
      store.dispatch(setMediaCacheMap({ "url-a": "cached-a" }));
      store.dispatch(setMediaCacheMap({ "url-b": "cached-b" }));
      expect(store.getState().mediaCacheMap.map).toEqual({ "url-b": "cached-b" });
    });

    it("accepts an empty map", () => {
      const store = createStore();
      store.dispatch(setMediaCacheMap({ "url-a": "cached-a" }));
      store.dispatch(setMediaCacheMap({}));
      expect(store.getState().mediaCacheMap.map).toEqual({});
    });
  });
});
