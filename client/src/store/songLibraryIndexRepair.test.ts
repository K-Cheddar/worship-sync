import { configureStore } from "@reduxjs/toolkit";
import type { DBItem, ServiceItem } from "../types";
import { allDocsSlice, removeItemFromAllDocs } from "./allDocsSlice";
import { allItemsSlice } from "./allItemsSlice";
import { createSongLibraryIndexRepairMiddleware } from "./songLibraryIndexRepair";

const songDoc = (id: string, name: string): DBItem =>
  ({ _id: id, name, type: "song", background: "" }) as DBItem;

const freeDoc = (id: string, name: string, slides = [{}]): DBItem =>
  ({ _id: id, name, type: "free", background: "blue", slides }) as DBItem;

const timerDoc = (id: string, name: string, background = "timer-bg"): DBItem =>
  ({
    _id: id,
    name,
    type: "timer",
    background,
    timerInfo: { id, name },
  }) as DBItem;

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

  it("does not resurrect a remote song deletion while its stale document catches up", () => {
    const store = createStore();
    const remoteSong: ServiceItem = {
      _id: "song-remote-delete",
      name: "Remote Song",
      type: "song",
      listId: "song-remote-delete",
      background: "",
    };
    const staleDoc = songDoc("song-remote-delete", "Remote Song");
    store.dispatch(allItemsSlice.actions.initiateAllItemsList([remoteSong]));
    store.dispatch(allDocsSlice.actions.updateAllSongDocs([staleDoc]));
    store.dispatch(allItemsSlice.actions.updateAllItemsListFromRemote([]));
    const deletedIndex = store.getState().allItems.list;

    store.dispatch(allDocsSlice.actions.updateAllSongDocs([staleDoc]));
    store.dispatch(allDocsSlice.actions.updateAllSongDocs([staleDoc]));
    expect(store.getState().allItems.list).toBe(deletedIndex);
    expect(store.getState().allItems.list).toEqual([]);

    store.dispatch(allDocsSlice.actions.updateAllSongDocs([]));
    expect(store.getState().allItems.list).toEqual([]);

    store.dispatch(allDocsSlice.actions.updateAllSongDocs([songDoc("song-remote-delete", "Song Restored Legitimately")]));
    expect(store.getState().allItems.list).toEqual([
      expect.objectContaining({ _id: "song-remote-delete", name: "Song Restored Legitimately" }),
    ]);
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

  it("repairs a timer when the library index loads before timer documents", () => {
    const store = createStore();
    store.dispatch(allItemsSlice.actions.initiateAllItemsList([]));
    store.dispatch(
      allDocsSlice.actions.updateAllTimerDocs([
        timerDoc("timer-restored", "11 AM Countdown", "navy"),
      ]),
    );

    expect(store.getState().allItems.list).toEqual([
      expect.objectContaining({
        _id: "timer-restored",
        name: "11 AM Countdown",
        type: "timer",
        background: "navy",
      }),
    ]);
  });

  it("repairs a timer when timer documents load before the library index", () => {
    const store = createStore();
    store.dispatch(
      allDocsSlice.actions.updateAllTimerDocs([
        timerDoc("timer-restored", "5 Minute Timer"),
      ]),
    );
    store.dispatch(allItemsSlice.actions.initiateAllItemsList([]));

    expect(store.getState().allItems.list).toEqual([
      expect.objectContaining({ _id: "timer-restored", type: "timer" }),
    ]);
  });

  it("preserves existing timer rows and avoids repeated repair entries", () => {
    const store = createStore();
    const existingTimer: ServiceItem = {
      _id: "timer-existing",
      name: "Current timer name",
      type: "timer",
      listId: "custom-list-id",
      background: "current-background",
    };
    store.dispatch(allItemsSlice.actions.initiateAllItemsList([existingTimer]));
    const docs = [
      timerDoc("timer-existing", "Old document name", "old-background"),
      timerDoc("timer-restored", "Restored timer"),
    ];
    store.dispatch(allDocsSlice.actions.updateAllTimerDocs(docs));
    const repairedList = store.getState().allItems.list;
    store.dispatch(allDocsSlice.actions.updateAllTimerDocs(docs));

    expect(store.getState().allItems.list).toBe(repairedList);
    expect(store.getState().allItems.list).toHaveLength(2);
    expect(store.getState().allItems.list).toContainEqual(existingTimer);
  });

  it("does not restore a locally deleted timer from a stale doc snapshot", () => {
    const store = createStore();
    const deletedTimer: ServiceItem = {
      _id: "timer-deleted",
      name: "Deleted timer",
      type: "timer",
      listId: "timer-deleted",
      background: "",
    };
    store.dispatch(allItemsSlice.actions.initiateAllItemsList([deletedTimer]));
    store.dispatch(
      allDocsSlice.actions.updateAllTimerDocs([
        timerDoc("timer-deleted", "Deleted timer"),
      ]),
    );
    store.dispatch(
      allItemsSlice.actions.removeItemFromAllItemsList("timer-deleted"),
    );
    store.dispatch(
      allDocsSlice.actions.updateAllTimerDocs([
        timerDoc("timer-deleted", "Deleted timer"),
      ]),
    );
    expect(store.getState().allItems.list).toEqual([]);

    store.dispatch(allDocsSlice.actions.updateAllTimerDocs([]));
    store.dispatch(allDocsSlice.actions.updateAllTimerDocs([]));
    expect(store.getState().allItems.list).toEqual([]);
  });

  it("does not restore a remotely removed timer before its tombstone arrives", () => {
    const store = createStore();
    const timer: ServiceItem = {
      _id: "timer-remote-deleted",
      name: "Remote timer",
      type: "timer",
      listId: "timer-remote-deleted",
      background: "",
    };
    const staleDoc = timerDoc("timer-remote-deleted", "Remote timer");
    store.dispatch(allItemsSlice.actions.initiateAllItemsList([timer]));
    store.dispatch(allDocsSlice.actions.updateAllTimerDocs([staleDoc]));
    store.dispatch(allItemsSlice.actions.updateAllItemsListFromRemote([]));
    store.dispatch(allDocsSlice.actions.updateAllTimerDocs([staleDoc]));
    expect(store.getState().allItems.list).toEqual([]);

    store.dispatch(allDocsSlice.actions.updateAllTimerDocs([]));
    expect(store.getState().allItems.list).toEqual([]);
  });

  it("keeps the latest remote timer row without duplicating it", () => {
    const store = createStore();
    const localTimer: ServiceItem = {
      _id: "timer-shared",
      name: "Local timer name",
      type: "timer",
      listId: "timer-shared",
      background: "local-background",
    };
    const remoteTimer: ServiceItem = {
      ...localTimer,
      name: "Remote timer name",
      background: "remote-background",
    };
    store.dispatch(allItemsSlice.actions.initiateAllItemsList([localTimer]));
    store.dispatch(
      allDocsSlice.actions.updateAllTimerDocs([
        timerDoc("timer-shared", "Older durable name", "old-background"),
      ]),
    );
    store.dispatch(
      allItemsSlice.actions.updateAllItemsListFromRemote([remoteTimer]),
    );
    store.dispatch(
      allDocsSlice.actions.updateAllTimerDocs([
        timerDoc("timer-shared", "Older durable name", "old-background"),
      ]),
    );

    expect(store.getState().allItems.list).toEqual([remoteTimer]);
  });
});
