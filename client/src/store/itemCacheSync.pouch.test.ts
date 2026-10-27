import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import { configureStore } from "@reduxjs/toolkit";
import { waitFor } from "@testing-library/react";
import allDocs from "./allDocsSlice";
import { startItemCacheSync } from "./itemCacheSync";
import type { DBItem } from "../types";

describe("item cache with real local PouchDB and replication", () => {
  it("replays real writes committed between the snapshot and live feed installation", async () => {
    const local = new PouchDB(`cache-gap-${Date.now()}`);
    await local.put({ _id: "song", type: "song", name: "Old" });
    await local.put({ _id: "deleted", type: "song", name: "Delete during loading" });
    const database = {
      allDocs: jest.fn(async () => {
        const snapshot = await local.allDocs({ include_docs: true, update_seq: true });
        await local.put({ ...await local.get("song"), name: "Updated during hydration" });
        await local.remove(await local.get("deleted"));
        await local.put({ _id: "created", type: "free", name: "Created during hydration" });
        return snapshot;
      }),
      changes: local.changes.bind(local),
    };
    const store = configureStore({ reducer: { allDocs } });
    const stop = startItemCacheSync(database as unknown as PouchDB.Database, store.dispatch);
    try {
      await waitFor(() => expect(store.getState().allDocs.allSongDocs.map((doc) => doc.name)).toEqual(["Updated during hydration"]));
      await waitFor(() => expect(store.getState().allDocs.allFreeFormDocs[0]?.name).toBe("Created during hydration"));
      expect(database.allDocs).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      await local.destroy();
    }
  });

  it("keeps concurrent caches current through local edits, offline writes, replication and deletes", async () => {
    const local = new PouchDB(`cache-local-${Date.now()}`);
    const remote = new PouchDB(`cache-remote-${Date.now()}`);
    const otherLocal = new PouchDB(local.name);
    const first = configureStore({ reducer: { allDocs } });
    const second = configureStore({ reducer: { allDocs } });
    const initial = { _id: "song", type: "song", name: "Original", background: "old", slides: [] };
    await local.put(initial);
    await local.put({ _id: "allItems", items: [{ _id: "index-only", name: "Historic", type: "song" }] });
    const historical = await local.get("allItems");
    const scan = jest.spyOn(local, "allDocs");
    const otherScan = jest.spyOn(otherLocal, "allDocs");
    const stopFirst = startItemCacheSync(local, first.dispatch);
    const stopSecond = startItemCacheSync(otherLocal, second.dispatch);
    try {
      await waitFor(() => expect(first.getState().allDocs.allSongDocs[0]?.name).toBe("Original"));
      await waitFor(() => expect(second.getState().allDocs.allSongDocs[0]?.name).toBe("Original"));
      const update = await local.get<DBItem>("song");
      await otherLocal.put({ ...update, name: "Renamed offline", background: "local-image://image" });
      await local.put({ _id: "custom", type: "free", name: "Custom", slides: [] });
      await local.put({ _id: "timer", type: "timer", name: "Timer" });
      await local.put({ _id: "bible", type: "bible", name: "John 3" });
      await local.put({ _id: "heading", type: "heading", name: "Worship" });
      await waitFor(() => expect(first.getState().allDocs.allFreeFormDocs[0]).toMatchObject({
        _id: "custom",
        name: "Custom",
        slides: [],
      }));
      await waitFor(() => expect(second.getState().allDocs.allFreeFormDocs[0]).toMatchObject({
        _id: "custom",
        name: "Custom",
        slides: [],
      }));
      await waitFor(() => expect(second.getState().allDocs.allSongDocs[0]).toMatchObject({ name: "Renamed offline", background: "local-image://image" }));
      await waitFor(() => expect(first.getState().allDocs.allHeadingDocs).toHaveLength(1));
      await waitFor(() => expect(second.getState().allDocs.allHeadingDocs).toHaveLength(1));
      const firstVersion = first.getState().allDocs.changeVersion;
      const secondVersion = second.getState().allDocs.changeVersion;
      await local.put({ _id: "outline", docType: "itemListDetails", items: [] });
      await local.put({ _id: "preferences", docType: "preferences" });
      await local.remove(await local.get("preferences"));
      await local.replicate.to(remote);
      expect(await remote.get("custom")).toMatchObject({
        name: "Custom",
        slides: [],
      });
      await remote.put({ _id: "overlay", docType: "overlay", type: "song", name: "Not an item" });
      const remoteSong = await remote.get<DBItem>("song");
      await remote.put({ ...remoteSong, name: "Remote rename", background: "remote background" });
      await local.replicate.from(remote);
      await waitFor(() => expect(first.getState().allDocs.allSongDocs[0]?.name).toBe("Remote rename"));
      await waitFor(() => expect(second.getState().allDocs.allSongDocs[0]?.background).toBe("remote background"));
      expect(first.getState().allDocs.changeVersion).toBe(firstVersion + 1);
      expect(second.getState().allDocs.changeVersion).toBe(secondVersion + 1);
      await remote.remove(await remote.get("song"));
      await local.replicate.from(remote);
      await waitFor(() => expect(first.getState().allDocs.allSongDocs).toEqual([]));
      await waitFor(() => expect(second.getState().allDocs.allSongDocs).toEqual([]));
      expect(scan).toHaveBeenCalledTimes(1);
      expect(otherScan).toHaveBeenCalledTimes(1); // Independent controller/database handles.
      expect(await local.get("allItems")).toEqual(historical);
      expect(first.getState().allDocs.allFreeFormDocs).toHaveLength(1);
      expect(first.getState().allDocs.allTimerDocs).toHaveLength(1);
      expect(first.getState().allDocs.allBibleDocs).toHaveLength(1);
      // Explicit deletion still persists and reaches both independent caches.
      await local.remove(await local.get("bible"));
      await local.remove(await local.get("heading"));
      await waitFor(() => expect(first.getState().allDocs.allBibleDocs).toEqual([]));
      await waitFor(() => expect(second.getState().allDocs.allHeadingDocs).toEqual([]));
      await expect(local.get("bible")).rejects.toMatchObject({ status: 404 });
      await expect(local.get("heading")).rejects.toMatchObject({ status: 404 });
    } finally {
      stopFirst();
      stopSecond();
      await local.destroy();
      await remote.destroy();
    }
  });
});
