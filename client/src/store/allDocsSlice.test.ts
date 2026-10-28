import { configureStore } from "@reduxjs/toolkit";
import allDocsReducer, {
  allDocsSlice,
  upsertItemInAllDocs,
  upsertItemsInAllDocs,
} from "./allDocsSlice";
import { hydrateItemCache, applyItemDocumentChange } from "./allDocsSlice";
import type { DBItem } from "../types";

const applyDoc = (doc: DBItem) => applyItemDocumentChange({ id: doc._id, doc });
const removeDoc = (doc: DBItem) => applyItemDocumentChange({ id: doc._id, deleted: true });

const createStore = () =>
  configureStore({ reducer: { allDocs: allDocsReducer } });

const makeDoc = (id: string, type: string): DBItem =>
  ({ _id: id, type, name: id, ...(type === "song" ? { arrangements: [], selectedArrangement: 0 } : {}) } as unknown as DBItem);

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
    it.each(["song", "free", "timer", "bible", "heading"])("updates and deletes cached %s items, including untyped tombstones", (type) => {
      const store = createStore();
      const doc = makeDoc("item", type);
      store.dispatch(hydrateItemCache([doc]));
      store.dispatch(applyDoc({ ...doc, name: "Updated" }));
      const updated = store.getState().allDocs;
      expect(updated.changeVersion).toBe(1);
      expect([...updated.allSongDocs, ...updated.allFreeFormDocs, ...updated.allTimerDocs, ...updated.allBibleDocs, ...updated.allHeadingDocs])
        .toEqual([{ ...doc, name: "Updated" }]);
      store.dispatch(applyItemDocumentChange({ id: doc._id, deleted: true }));
      const deleted = store.getState().allDocs;
      expect(deleted.changeVersion).toBe(2);
      expect([...deleted.allSongDocs, ...deleted.allFreeFormDocs, ...deleted.allTimerDocs, ...deleted.allBibleDocs, ...deleted.allHeadingDocs])
        .toEqual([]);
    });

    it("preserves the cache reference and version for unrelated documents and absent tombstones", () => {
      const store = createStore();
      store.dispatch(hydrateItemCache([makeDoc("song", "song")]));
      const before = store.getState().allDocs;
      store.dispatch(applyDoc(makeDoc("outline", "itemListDetails")));
      store.dispatch(applyDoc({ ...makeDoc("overlay", "song"), docType: "overlay" } as unknown as DBItem));
      store.dispatch(applyItemDocumentChange({ id: "preferences" }));
      store.dispatch(applyItemDocumentChange({ id: "preferences", deleted: true }));
      expect(store.getState().allDocs).toBe(before);
      expect(store.getState().allDocs.changeVersion).toBe(0);
    });

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
describe("allDocsSlice song normalization boundary", () => {
  it("keeps bulk and individual song upserts arrangement-canonical", () => {
    const legacySlide = {
      id: "legacy",
      type: "Verse" as const,
      name: "Verse 1",
      boxes: [],
      monitorCurrentBandBoxes: [{ id: "clone" }],
    };
    const song = {
      _id: "song-1",
      name: "Song",
      type: "song",
      slides: [legacySlide],
      monitorLayout: { currentFontSizePx: 40, nextFontSizePx: 39 },
      arrangements: [{
        id: "arr-1",
        name: "Master",
        formattedLyrics: [],
        songOrder: [],
        slides: [],
      }],
    } as unknown as DBItem;

    const bulk = allDocsSlice.reducer(
      undefined,
      allDocsSlice.actions.updateAllSongDocs([song]),
    ).allSongDocs[0];
    const single = allDocsSlice.reducer(
      undefined,
      allDocsSlice.actions.upsertItemInAllDocs(song),
    ).allSongDocs[0];
    const multiple = allDocsSlice.reducer(
      undefined,
      allDocsSlice.actions.upsertItemsInAllDocs([song]),
    ).allSongDocs[0];

    for (const normalized of [bulk, single, multiple]) {
      expect(normalized).not.toHaveProperty("slides");
      expect(normalized).not.toHaveProperty("monitorLayout");
      expect(normalized.arrangements[0].slides[0]).not.toHaveProperty("monitorCurrentBandBoxes");
      expect(normalized.arrangements[0].slides[0].id).toBe("legacy");
    }
  });
});


it("keeps exact v2 upserts lightweight and rejects stale legacy echoes", () => {
  const store = createStore();
  const exact: DBItem = { ...makeDoc("v2", "song"), docType: "song-v2-root", arrangements: [{ id: "a", name: "Master", formattedLyrics: [], songOrder: [], slides: [{ id: "s", type: "Verse", name: "Verse", boxes: [] }] }] };
  store.dispatch(upsertItemInAllDocs(exact));
  store.dispatch(upsertItemInAllDocs({ ...makeDoc("v2", "song"), name: "Stale" }));
  store.dispatch(upsertItemsInAllDocs([{ ...makeDoc("v2", "song"), name: "Stale batch" }]));
  expect(store.getState().allDocs.allSongDocs).toHaveLength(1);
  expect(store.getState().allDocs.allSongDocs[0]).toMatchObject({ name: "v2", docType: "song-v2-root", arrangements: [{ slides: [] }] });
});
