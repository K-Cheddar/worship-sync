import { configureStore } from "@reduxjs/toolkit";
import type { DBItem, ServiceItem } from "../types";
import { allDocsSlice } from "./allDocsSlice";
import { allItemsSlice } from "./allItemsSlice";
import { createSongLibraryIndexRepairMiddleware } from "./songLibraryIndexRepair";

const songDoc = (id: string, name: string): DBItem =>
  ({ _id: id, name, type: "song", background: "" }) as DBItem;

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

describe("song library index repair middleware", () => {
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
});
