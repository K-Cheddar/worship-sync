import { configureStore } from "@reduxjs/toolkit";
import allDocsReducer, { hydrateItemCache, applyItemDocumentChange } from "./allDocsSlice";
import type { DBItem } from "../types";

const applyDoc = (doc: DBItem) => applyItemDocumentChange({ id: doc._id, doc });
const removeDoc = (doc: DBItem) => applyItemDocumentChange({ id: doc._id, deleted: true });

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
    it("hydrateItemCache replaces song docs", () => {
      const store = createStore();
      store.dispatch(hydrateItemCache([makeDoc("s1", "song")]));
      expect(store.getState().allDocs.allSongDocs).toHaveLength(1);
    });

    it("hydrateItemCache replaces free docs", () => {
      const store = createStore();
      store.dispatch(hydrateItemCache([makeDoc("f1", "free")]));
      expect(store.getState().allDocs.allFreeFormDocs).toHaveLength(1);
    });

    it("hydrateItemCache replaces timer docs", () => {
      const store = createStore();
      store.dispatch(hydrateItemCache([makeDoc("t1", "timer")]));
      expect(store.getState().allDocs.allTimerDocs).toHaveLength(1);
    });

    it("hydrateItemCache replaces bible docs", () => {
      const store = createStore();
      store.dispatch(hydrateItemCache([makeDoc("b1", "bible")]));
      expect(store.getState().allDocs.allBibleDocs).toHaveLength(1);
    });
  });

  describe("applyDoc", () => {
    it("appends a new song doc when not already present", () => {
      const store = createStore();
      store.dispatch(applyDoc(makeDoc("s1", "song")));
      expect(store.getState().allDocs.allSongDocs).toHaveLength(1);
      expect(store.getState().allDocs.allSongDocs[0]._id).toBe("s1");
    });

    it("replaces an existing song doc with the same _id", () => {
      const store = createStore();
      store.dispatch(hydrateItemCache([makeDoc("s1", "song")]));
      const updated = { ...makeDoc("s1", "song"), name: "Updated" };
      store.dispatch(applyDoc(updated));
      const docs = store.getState().allDocs.allSongDocs;
      expect(docs).toHaveLength(1);
      expect(docs[0].name).toBe("Updated");
    });

    it("routes free docs to allFreeFormDocs", () => {
      const store = createStore();
      store.dispatch(applyDoc(makeDoc("f1", "free")));
      expect(store.getState().allDocs.allFreeFormDocs).toHaveLength(1);
      expect(store.getState().allDocs.allSongDocs).toHaveLength(0);
    });

    it("routes timer docs to allTimerDocs", () => {
      const store = createStore();
      store.dispatch(applyDoc(makeDoc("t1", "timer")));
      expect(store.getState().allDocs.allTimerDocs).toHaveLength(1);
    });

    it("routes bible docs to allBibleDocs", () => {
      const store = createStore();
      store.dispatch(applyDoc(makeDoc("b1", "bible")));
      expect(store.getState().allDocs.allBibleDocs).toHaveLength(1);
    });

    it("ignores docs with an unknown type", () => {
      const store = createStore();
      store.dispatch(applyDoc(makeDoc("x1", "unknown")));
      const state = store.getState().allDocs;
      expect(state.allSongDocs).toHaveLength(0);
      expect(state.allFreeFormDocs).toHaveLength(0);
      expect(state.allTimerDocs).toHaveLength(0);
      expect(state.allBibleDocs).toHaveLength(0);
    });
  });

  it("upserts fetched documents across libraries in one reducer action", () => {
    const store = createStore();
    store.dispatch(
      hydrateItemCache([
        makeDoc("song-1", "song"),
        makeDoc("free-1", "free"),
      ]),
    );
    expect(store.getState().allDocs.allSongDocs).toEqual([
      expect.objectContaining({ _id: "song-1" }),
    ]);
    expect(store.getState().allDocs.allFreeFormDocs).toEqual([
      expect.objectContaining({ _id: "free-1" }),
    ]);
  });

  describe("removeDoc", () => {
    it("removes only the matching document from its library", () => {
      const store = createStore();
      store.dispatch(
        hydrateItemCache([
          makeDoc("song-1", "song"),
          makeDoc("song-2", "song"),
        ]),
      );

      store.dispatch(removeDoc(makeDoc("song-1", "song")));

      expect(store.getState().allDocs.allSongDocs).toEqual([
        expect.objectContaining({ _id: "song-2" }),
      ]);
    });
  });
});
