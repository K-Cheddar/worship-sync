import { configureStore } from "@reduxjs/toolkit";
import allDocsReducer, {
  updateAllSongDocs,
  updateAllFreeFormDocs,
  updateAllTimerDocs,
  updateAllBibleDocs,
  upsertItemInAllDocs,
} from "./allDocsSlice";
import type { DBItem } from "../types";

const createStore = () =>
  configureStore({ reducer: { allDocs: allDocsReducer } });

const makeDoc = (id: string, type: string): DBItem =>
  ({ _id: id, type, name: id } as DBItem);

describe("allDocsSlice", () => {
  describe("initial state", () => {
    it("starts with empty doc lists", () => {
      const store = createStore();
      const state = store.getState().allDocs;
      expect(state.allSongDocs).toEqual([]);
      expect(state.allFreeFormDocs).toEqual([]);
      expect(state.allTimerDocs).toEqual([]);
      expect(state.allBibleDocs).toEqual([]);
    });
  });

  describe("bulk update actions", () => {
    it("updateAllSongDocs replaces song docs", () => {
      const store = createStore();
      store.dispatch(updateAllSongDocs([makeDoc("s1", "song")]));
      expect(store.getState().allDocs.allSongDocs).toHaveLength(1);
    });

    it("updateAllFreeFormDocs replaces free docs", () => {
      const store = createStore();
      store.dispatch(updateAllFreeFormDocs([makeDoc("f1", "free")]));
      expect(store.getState().allDocs.allFreeFormDocs).toHaveLength(1);
    });

    it("updateAllTimerDocs replaces timer docs", () => {
      const store = createStore();
      store.dispatch(updateAllTimerDocs([makeDoc("t1", "timer")]));
      expect(store.getState().allDocs.allTimerDocs).toHaveLength(1);
    });

    it("updateAllBibleDocs replaces bible docs", () => {
      const store = createStore();
      store.dispatch(updateAllBibleDocs([makeDoc("b1", "bible")]));
      expect(store.getState().allDocs.allBibleDocs).toHaveLength(1);
    });
  });

  describe("upsertItemInAllDocs", () => {
    it("appends a new song doc when not already present", () => {
      const store = createStore();
      store.dispatch(upsertItemInAllDocs(makeDoc("s1", "song")));
      expect(store.getState().allDocs.allSongDocs).toHaveLength(1);
      expect(store.getState().allDocs.allSongDocs[0]._id).toBe("s1");
    });

    it("replaces an existing song doc with the same _id", () => {
      const store = createStore();
      store.dispatch(updateAllSongDocs([makeDoc("s1", "song")]));
      const updated = { ...makeDoc("s1", "song"), name: "Updated" };
      store.dispatch(upsertItemInAllDocs(updated));
      const docs = store.getState().allDocs.allSongDocs;
      expect(docs).toHaveLength(1);
      expect(docs[0].name).toBe("Updated");
    });

    it("routes free docs to allFreeFormDocs", () => {
      const store = createStore();
      store.dispatch(upsertItemInAllDocs(makeDoc("f1", "free")));
      expect(store.getState().allDocs.allFreeFormDocs).toHaveLength(1);
      expect(store.getState().allDocs.allSongDocs).toHaveLength(0);
    });

    it("routes timer docs to allTimerDocs", () => {
      const store = createStore();
      store.dispatch(upsertItemInAllDocs(makeDoc("t1", "timer")));
      expect(store.getState().allDocs.allTimerDocs).toHaveLength(1);
    });

    it("routes bible docs to allBibleDocs", () => {
      const store = createStore();
      store.dispatch(upsertItemInAllDocs(makeDoc("b1", "bible")));
      expect(store.getState().allDocs.allBibleDocs).toHaveLength(1);
    });

    it("ignores docs with an unknown type", () => {
      const store = createStore();
      store.dispatch(upsertItemInAllDocs(makeDoc("x1", "unknown")));
      const state = store.getState().allDocs;
      expect(state.allSongDocs).toHaveLength(0);
      expect(state.allFreeFormDocs).toHaveLength(0);
      expect(state.allTimerDocs).toHaveLength(0);
      expect(state.allBibleDocs).toHaveLength(0);
    });
  });
});
