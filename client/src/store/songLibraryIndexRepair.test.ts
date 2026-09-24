import { configureStore } from "@reduxjs/toolkit";
import type { DBItem, ServiceItem } from "../types";
import { allDocsSlice, removeItemFromAllDocs } from "./allDocsSlice";
import { allItemsSlice } from "./allItemsSlice";
import { createSongLibraryIndexRepairMiddleware } from "./songLibraryIndexRepair";

const songDoc = (id: string, name: string): DBItem =>
  ({ _id: id, name, type: "song", background: "" }) as DBItem;

const freeDoc = (id: string, name: string, slides = [{}]): DBItem =>
  ({ _id: id, name, type: "free", background: "blue", slides }) as DBItem;

const timerItem: ServiceItem = {
  _id: "timer-1",
  name: "Countdown",
  type: "timer",
  listId: "",
  background: "",
};

const createStore = () => {
  const repairMiddleware = createSongLibraryIndexRepairMiddleware();

  return configureStore({
    reducer: {
      allItems: allItemsSlice.reducer,
      allDocs: allDocsSlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(repairMiddleware.middleware),
  });
};

describe("library index repair middleware", () => {
  it("restores durable songs after both library sources initialize", () => {
    const store = createStore();

    store.dispatch(allItemsSlice.actions.initiateAllItemsList([timerItem]));
    store.dispatch(
      allDocsSlice.actions.updateAllSongDocs([
        songDoc("song-restored", "Restored Song"),
      ]),
    );

    expect(store.getState().allItems.list).toEqual([
      expect.objectContaining({ _id: "timer-1" }),
      expect.objectContaining({
        _id: "song-restored",
        name: "Restored Song",
      }),
    ]);
  });

  it("repairs a partial index received from another environment", () => {
    const store = createStore();

    store.dispatch(
      allDocsSlice.actions.updateAllSongDocs([
        songDoc("song-durable", "Durable Song"),
      ]),
    );
    store.dispatch(allItemsSlice.actions.initiateAllItemsList([]));
    store.dispatch(allItemsSlice.actions.updateAllItemsListFromRemote([]));

    expect(store.getState().allItems.list).toEqual([
      expect.objectContaining({
        _id: "song-durable",
        name: "Durable Song",
      }),
    ]);
  });

  it("waits until the lightweight index is initialized", () => {
    const store = createStore();

    store.dispatch(
      allDocsSlice.actions.updateAllSongDocs([
        songDoc("song-durable", "Durable Song"),
      ]),
    );

    expect(store.getState().allItems.list).toEqual([]);
  });

  it("recovers Welcome Slides from its durable custom document", () => {
    const store = createStore();
    const welcomeSlides = freeDoc("Welcome Slides", "Welcome Slides", [
      { id: "slide-1", boxes: [{ words: "Welcome" }] },
      { id: "slide-2", boxes: [{ words: "We're glad you're here" }] },
    ]);

    store.dispatch(allItemsSlice.actions.initiateAllItemsList([]));
    store.dispatch(allDocsSlice.actions.updateAllFreeFormDocs([welcomeSlides]));

    expect(store.getState().allItems.list).toEqual([
      expect.objectContaining({
        _id: "Welcome Slides",
        name: "Welcome Slides",
        type: "free",
        background: "blue",
      }),
    ]);
    expect(welcomeSlides.slides).toEqual([
      { id: "slide-1", boxes: [{ words: "Welcome" }] },
      { id: "slide-2", boxes: [{ words: "We're glad you're here" }] },
    ]);
  });

  it("does not append or write unchanged entries on repeated initialization", () => {
    const store = createStore();
    const durableDoc = freeDoc("custom-1", "Welcome Slides");
    store.dispatch(allItemsSlice.actions.initiateAllItemsList([]));
    store.dispatch(allDocsSlice.actions.updateAllFreeFormDocs([durableDoc]));
    const recoveredList = store.getState().allItems.list;

    store.dispatch(allItemsSlice.actions.initiateAllItemsList(recoveredList));
    store.dispatch(allDocsSlice.actions.updateAllFreeFormDocs([durableDoc]));

    expect(store.getState().allItems.list).toBe(recoveredList);
    expect(store.getState().allItems.list).toHaveLength(1);
  });

  it("does not resurrect a custom item after its document is deleted", () => {
    const store = createStore();
    store.dispatch(allItemsSlice.actions.initiateAllItemsList([]));
    store.dispatch(
      allDocsSlice.actions.updateAllFreeFormDocs([
        freeDoc("custom-deleted", "Deleted custom item"),
      ]),
    );
    store.dispatch(
      allItemsSlice.actions.removeItemFromAllItemsList("custom-deleted"),
    );
    store.dispatch(removeItemFromAllDocs({ _id: "custom-deleted", type: "free" }));
    // The next PouchDB hydration excludes deleted/tombstoned documents.
    store.dispatch(allDocsSlice.actions.updateAllFreeFormDocs([]));

    expect(store.getState().allItems.list).toEqual([]);
  });

  it("preserves a newer remote index row when reconciling custom documents", () => {
    const store = createStore();
    const durableDoc = freeDoc("custom-1", "Older document name");
    const newerRemoteItem: ServiceItem = {
      _id: "custom-1",
      name: "Newer remote name",
      type: "free",
      listId: "custom-1",
      background: "newer-background",
    };

    store.dispatch(allDocsSlice.actions.updateAllFreeFormDocs([durableDoc]));
    store.dispatch(allItemsSlice.actions.initiateAllItemsList([]));
    store.dispatch(
      allItemsSlice.actions.updateAllItemsListFromRemote([newerRemoteItem]),
    );
    store.dispatch(allDocsSlice.actions.updateAllFreeFormDocs([durableDoc]));

    expect(store.getState().allItems.list).toEqual([newerRemoteItem]);
  });

  it("waits for remote durable docs before repairing a remote index", () => {
    const store = createStore();
    const deletedDoc = freeDoc("custom-deleted", "Deleted custom item");
    store.dispatch(allItemsSlice.actions.initiateAllItemsList([]));
    store.dispatch(allDocsSlice.actions.updateAllFreeFormDocs([deletedDoc]));
    store.dispatch(allItemsSlice.actions.updateAllItemsListFromRemote([]));

    expect(store.getState().allItems.list).toEqual([]);

    // The remote PouchDB tombstone is now reflected by the post-sync scan.
    store.dispatch(allDocsSlice.actions.updateAllFreeFormDocs([]));

    expect(store.getState().allItems.list).toEqual([]);
  });
});
