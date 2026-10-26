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

const song = (id: string) => ({ _id: id, name: id, type: "song", arrangements: [], slides: [] }) as unknown as DBItem;
const setup = (read: jest.Mock, info = jest.fn().mockResolvedValue({ update_seq: 0 })) => {
  const store = configureStore({ reducer: { allDocs } });
  store.dispatch(hydrateItemCache([song("cached")]));
  const context = createMockControllerContext({ db: createMockPouchDB({ allDocs: read, info }) });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}><ControllerInfoContext.Provider value={context as never}>{children}</ControllerInfoContext.Provider></Provider>
  );
  return { store, wrapper };
};

it("uses loaded documents for navigation and scrolling without database reads", () => {
  const read = jest.fn();
  const { wrapper } = setup(read);
  const { result } = renderHook(() => useOutlineItemDocs(["cached"]), { wrapper });
  expect(result.current.get("cached")).toEqual(song("cached"));
  expect(read).not.toHaveBeenCalled();
});

it("loads a genuinely missing document into the existing cache", async () => {
  const read = jest.fn().mockResolvedValue({ update_seq: 0, rows: [{ doc: song("missing") }] });
  const { store, wrapper } = setup(read);
  const { result } = renderHook(() => useOutlineItemDocs(["cached", "missing"]), { wrapper });
  await waitFor(() => expect(result.current.get("missing")).toEqual(song("missing")));
  expect(store.getState().allDocs.allSongDocs).toContainEqual(song("missing"));
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith({ keys: ["missing"], include_docs: true, update_seq: true });
});

it("does not resurrect a deleted missing document from an older asynchronous response", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => { finish = resolve; });
  const read = jest.fn().mockReturnValueOnce(pending).mockResolvedValue({ update_seq: 1, rows: [] });
  const { store, wrapper } = setup(read, jest.fn().mockResolvedValue({ update_seq: 1 }));
  const { result } = renderHook(() => useOutlineItemDocs(["missing"]), { wrapper });
  const cacheBeforeDeletion = store.getState().allDocs;
  act(() => { store.dispatch(applyItemDocumentChange({ id: "missing", deleted: true })); });
  expect(store.getState().allDocs).toBe(cacheBeforeDeletion);
  await act(async () => { finish({ update_seq: 0, rows: [{ doc: song("missing") }] }); await pending; });
  expect(result.current.has("missing")).toBe(false);
  expect(store.getState().allDocs.allSongDocs).toEqual([song("cached")]);
});

it("does not replace a newer cached document with a delayed missing-document read", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => { finish = resolve; });
  const read = jest.fn().mockReturnValue(pending);
  const { store, wrapper } = setup(read);
  const { result } = renderHook(() => useOutlineItemDocs(["missing"]), { wrapper });
  act(() => { store.dispatch(applyItemDocumentChange({ id: "missing", doc: { ...song("missing"), name: "Newer" } })); });
  await act(async () => { finish({ update_seq: 0, rows: [{ doc: song("missing") }] }); await pending; });
  expect(result.current.get("missing")?.name).toBe("Newer");
});

it("ignores sequence verification from a retired prefetch after the route changes", async () => {
  let finish!: (value: { update_seq: number }) => void;
  const pending = new Promise<{ update_seq: number }>((resolve) => { finish = resolve; });
  const read = jest.fn().mockResolvedValue({ update_seq: 0, rows: [{ doc: song("missing") }] });
  const info = jest.fn().mockReturnValue(pending);
  const { store, wrapper } = setup(read, info);
  const { result, rerender } = renderHook(({ ids }) => useOutlineItemDocs(ids), {
    initialProps: { ids: ["missing"] }, wrapper,
  });
  await waitFor(() => expect(info).toHaveBeenCalledTimes(1));
  rerender({ ids: ["cached"] });
  await act(async () => { finish({ update_seq: 0 }); await pending; });
  expect(result.current.has("missing")).toBe(false);
  expect(store.getState().allDocs.allSongDocs).toEqual([song("cached")]);
});

it("checks the real PouchDB sequence before publishing a missing document deleted during its read", async () => {
  const local = new PouchDB(`missing-item-${Date.now()}`);
  await local.put(song("missing"));
  const read = jest.fn()
    .mockImplementationOnce(async (options) => {
      const snapshot = await local.allDocs(options);
      await local.remove(await local.get("missing"));
      return snapshot;
    })
    .mockImplementation((options) => local.allDocs(options));
  const { store, wrapper } = setup(read, jest.fn(() => local.info()));
  const { result, unmount } = renderHook(() => useOutlineItemDocs(["missing"]), { wrapper });
  try {
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(result.current.has("missing")).toBe(false);
    expect(store.getState().allDocs.allSongDocs).toEqual([song("cached")]);
    await expect(local.get("missing")).rejects.toMatchObject({ status: 404 });
  } finally {
    unmount();
    await local.destroy();
  }
});
