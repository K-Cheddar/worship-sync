import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import { act, renderHook, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { useOutlineItemDocs } from "./useOutlineItemDocs";
import { ControllerInfoContext } from "../context/controllerInfo";
import allDocs, { applyItemDocumentChange, hydrateItemCache } from "../store/allDocsSlice";
import type { DBItem } from "../types";
import { createMockControllerContext, createMockPouchDB } from "../test/mocks";

const song = (id: string, name = id) => ({ _id: id, name, type: "song", arrangements: [], selectedArrangement: 0 }) as unknown as DBItem;
const setup = (read: jest.Mock, changes = jest.fn().mockResolvedValue({ results: [] })) => {
  const store = configureStore({ reducer: { allDocs } });
  store.dispatch(hydrateItemCache([song("cached")]));
  const context = createMockControllerContext({ db: createMockPouchDB({ allDocs: read, changes }) });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}><ControllerInfoContext.Provider value={context as never}>{children}</ControllerInfoContext.Provider></Provider>
  );
  return { store, wrapper };
};

it("uses loaded documents for navigation and scrolling without database reads", () => {
  const read = jest.fn();
  const changes = jest.fn();
  const { wrapper } = setup(read, changes);
  const { result } = renderHook(() => useOutlineItemDocs(["cached"]), { wrapper });
  expect(result.current.get("cached")).toEqual(song("cached"));
  expect(read).not.toHaveBeenCalled();
  expect(changes).not.toHaveBeenCalled();
});

it("loads a genuinely missing document with one keyed lookup and one targeted validation", async () => {
  const read = jest.fn().mockResolvedValue({ update_seq: 0, rows: [{ doc: song("missing") }] });
  const changes = jest.fn().mockResolvedValue({ results: [] });
  const { store, wrapper } = setup(read, changes);
  const { result } = renderHook(() => useOutlineItemDocs(["cached", "missing"]), { wrapper });
  await waitFor(() => expect(result.current.get("missing")).toEqual(song("missing")));
  expect(store.getState().allDocs.allSongDocs).toContainEqual(song("missing"));
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith({ keys: ["missing"], include_docs: true, update_seq: true });
  expect(changes).toHaveBeenCalledTimes(1);
  expect(changes).toHaveBeenCalledWith({ since: 0, doc_ids: ["missing"], include_docs: true });
});

it("does not retry a cache miss when unrelated database documents change", async () => {
  const local = new PouchDB(`unrelated-item-write-${Date.now()}`);
  await local.put(song("missing"));
  const read = jest.fn().mockImplementation(async (options) => {
    const snapshot = await local.allDocs(options);
    await local.put({ _id: "outline", docType: "itemListDetails", items: [] });
    await local.put({ _id: "preferences", docType: "preferences" });
    await local.put({ _id: "overlay", docType: "overlay", text: "changed" });
    return snapshot;
  });
  const changes = jest.fn((options) => local.changes(options));
  const { wrapper } = setup(read, changes);
  const { result, unmount } = renderHook(() => useOutlineItemDocs(["missing"]), { wrapper });
  try {
    await waitFor(() => expect(result.current.has("missing")).toBe(true));
    expect(read).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledWith(expect.objectContaining({ doc_ids: ["missing"], include_docs: true }));
  } finally {
    unmount();
    await local.destroy();
  }
});

it("does not resurrect a document deleted during its asynchronous snapshot read", async () => {
  const local = new PouchDB(`deleted-item-read-${Date.now()}`);
  await local.put(song("missing"));
  const read = jest.fn().mockImplementation(async (options) => {
    const snapshot = await local.allDocs(options);
    await local.remove(await local.get("missing"));
    return snapshot;
  });
  const changes = jest.fn((options) => local.changes(options));
  const { store, wrapper } = setup(read, changes);
  const { result, unmount } = renderHook(() => useOutlineItemDocs(["missing"]), { wrapper });
  try {
    await waitFor(() => expect(changes).toHaveBeenCalledTimes(1));
    expect(result.current.has("missing")).toBe(false);
    expect(store.getState().allDocs.allSongDocs).toEqual([song("cached")]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledWith(expect.objectContaining({ doc_ids: ["missing"], include_docs: true }));
    await expect(local.get("missing")).rejects.toMatchObject({ status: 404 });
  } finally {
    unmount();
    await local.destroy();
  }
});

it("uses the latest matching document change instead of the older snapshot", async () => {
  const local = new PouchDB(`updated-item-read-${Date.now()}`);
  await local.put(song("missing", "Original"));
  const read = jest.fn().mockImplementation(async (options) => {
    const snapshot = await local.allDocs(options);
    await local.put({ ...await local.get("missing"), name: "Updated during read" });
    return snapshot;
  });
  const changes = jest.fn((options) => local.changes(options));
  const { store, wrapper } = setup(read, changes);
  const { result, unmount } = renderHook(() => useOutlineItemDocs(["missing"]), { wrapper });
  try {
    await waitFor(() => expect(result.current.get("missing")?.name).toBe("Updated during read"));
    expect(store.getState().allDocs.allSongDocs).toContainEqual(expect.objectContaining({ _id: "missing", name: "Updated during read" }));
    expect(read).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledTimes(1);
  } finally {
    unmount();
    await local.destroy();
  }
});

it("uses a replicated item update that arrives during the keyed read", async () => {
  const local = new PouchDB(`replicated-item-read-${Date.now()}`);
  const remote = new PouchDB(`replicated-item-source-${Date.now()}`);
  await remote.put(song("missing", "Before replication"));
  await remote.replicate.to(local);
  const read = jest.fn().mockImplementation(async (options) => {
    const snapshot = await local.allDocs(options);
    await remote.put({ ...await remote.get("missing"), name: "Replicated during read" });
    await remote.replicate.to(local);
    return snapshot;
  });
  const changes = jest.fn((options) => local.changes(options));
  const { store, wrapper } = setup(read, changes);
  const { result, unmount } = renderHook(() => useOutlineItemDocs(["missing"]), { wrapper });
  try {
    await waitFor(() => expect(result.current.get("missing")?.name).toBe("Replicated during read"));
    expect(store.getState().allDocs.allSongDocs).toContainEqual(expect.objectContaining({ _id: "missing", name: "Replicated during read" }));
    expect(read).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledTimes(1);
  } finally {
    unmount();
    await local.destroy();
    await remote.destroy();
  }
});

it("does not replace a newer live cache update while targeted validation is pending", async () => {
  let finish!: (value: { results: unknown[] }) => void;
  const pending = new Promise<{ results: unknown[] }>((resolve) => { finish = resolve; });
  const read = jest.fn().mockResolvedValue({ update_seq: 0, rows: [{ doc: song("missing", "Snapshot") }] });
  const changes = jest.fn().mockReturnValue(pending);
  const { store, wrapper } = setup(read, changes);
  const { result } = renderHook(() => useOutlineItemDocs(["missing"]), { wrapper });
  await waitFor(() => expect(changes).toHaveBeenCalledTimes(1));
  act(() => {
    store.dispatch(applyItemDocumentChange({ id: "missing", doc: song("missing", "Live update") }));
  });
  await act(async () => { finish({ results: [] }); await pending; });
  expect(result.current.get("missing")?.name).toBe("Live update");
  expect(store.getState().allDocs.allSongDocs).toContainEqual(expect.objectContaining({ _id: "missing", name: "Live update" }));
  expect(read).toHaveBeenCalledTimes(1);
  expect(changes).toHaveBeenCalledTimes(1);
});

it("ignores a pending cache miss after the requested route changes", async () => {
  let finish!: (value: { results: unknown[] }) => void;
  const pending = new Promise<{ results: unknown[] }>((resolve) => { finish = resolve; });
  const read = jest.fn().mockResolvedValue({ update_seq: 0, rows: [{ doc: song("missing") }] });
  const changes = jest.fn().mockReturnValue(pending);
  const { store, wrapper } = setup(read, changes);
  const { result, rerender } = renderHook(({ ids }) => useOutlineItemDocs(ids), {
    initialProps: { ids: ["missing"] }, wrapper,
  });
  await waitFor(() => expect(changes).toHaveBeenCalledTimes(1));
  rerender({ ids: ["cached"] });
  await act(async () => { finish({ results: [{ id: "missing", doc: song("missing") }] }); await pending; });
  expect(result.current.has("missing")).toBe(false);
  expect(store.getState().allDocs.allSongDocs).toEqual([song("cached")]);
});

it("ignores a pending cache miss after the Redux database session changes", async () => {
  let finish!: (value: { results: unknown[] }) => void;
  const pending = new Promise<{ results: unknown[] }>((resolve) => { finish = resolve; });
  const oldRead = jest.fn().mockResolvedValue({ update_seq: 0, rows: [{ doc: song("missing") }] });
  const oldChanges = jest.fn().mockReturnValue(pending);
  const oldSession = setup(oldRead, oldChanges);
  const newRead = jest.fn().mockResolvedValue({ update_seq: 0, rows: [] });
  const newChanges = jest.fn().mockResolvedValue({ results: [] });
  const newSession = setup(newRead, newChanges);
  let activeStore = oldSession.store;
  let activeDb = createMockPouchDB({ allDocs: oldRead, changes: oldChanges });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={activeStore}>
      <ControllerInfoContext.Provider value={createMockControllerContext({ db: activeDb }) as never}>
        {children}
      </ControllerInfoContext.Provider>
    </Provider>
  );
  const { result, rerender } = renderHook(() => useOutlineItemDocs(["missing"]), { wrapper });
  await waitFor(() => expect(oldChanges).toHaveBeenCalledTimes(1));
  activeStore = newSession.store;
  activeDb = createMockPouchDB({ allDocs: newRead, changes: newChanges });
  rerender();
  await waitFor(() => expect(newChanges).toHaveBeenCalledTimes(1));
  await act(async () => { finish({ results: [{ id: "missing", doc: song("missing") }] }); await pending; });
  expect(result.current.has("missing")).toBe(false);
  expect(newSession.store.getState().allDocs.allSongDocs).toEqual([song("cached")]);
});
