import { configureStore } from "@reduxjs/toolkit";
import userReducer, { update } from "./userSlice";

const createStore = () =>
  configureStore({ reducer: { user: userReducer } });

describe("userSlice", () => {
  describe("initial state", () => {
    it("starts with default Demo name and empty lists", () => {
      const store = createStore();
      const state = store.getState().user;
      expect(state.name).toBe("Demo");
      expect(state.quickLinks).toEqual([]);
      expect(state.defaultBackgrounds).toEqual([]);
    });
  });

  describe("update", () => {
    it("updates the user name", () => {
      const store = createStore();
      store.dispatch(update("Alice"));
      expect(store.getState().user.name).toBe("Alice");
    });

    it("allows updating the name to an empty string", () => {
      const store = createStore();
      store.dispatch(update(""));
      expect(store.getState().user.name).toBe("");
    });

    it("overwrites a previously set name", () => {
      const store = createStore();
      store.dispatch(update("Alice"));
      store.dispatch(update("Bob"));
      expect(store.getState().user.name).toBe("Bob");
    });
  });
});
