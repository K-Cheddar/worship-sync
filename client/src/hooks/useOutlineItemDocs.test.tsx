import { act, renderHook, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { useOutlineItemDocs } from "./useOutlineItemDocs";
import { ControllerInfoContext } from "../context/controllerInfo";
import allDocs, { applyItemDocumentChange, hydrateItemCache } from "../store/allDocsSlice";
import type { DBItem } from "../types";
import { createMockControllerContext, createMockPouchDB } from "../test/mocks";

const song = (id: string) => ({ _id: id, name: id, type: "song", arrangements: [], slides: [] }) as unknown as DBItem;
const setup = (read: jest.Mock) => {
  const store = configureStore({ reducer: { allDocs } });
  store.dispatch(hydrateItemCache([song("cached")]));
  const context = createMockControllerContext({ db: createMockPouchDB({ allDocs: read }) });
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
  const read = jest.fn().mockResolvedValue({ rows: [{ doc: song("missing") }] });
  const { store, wrapper } = setup(read);
  const { result } = renderHook(() => useOutlineItemDocs(["cached", "missing"]), { wrapper });
  await waitFor(() => expect(result.current.get("missing")).toEqual(song("missing")));
  expect(store.getState().allDocs.allSongDocs).toContainEqual(song("missing"));
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith({ keys: ["missing"], include_docs: true });
});

it("does not resurrect a deleted missing document from an older asynchronous response", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => { finish = resolve; });
  const read = jest.fn().mockReturnValueOnce(pending).mockResolvedValue({ rows: [] });
  const { store, wrapper } = setup(read);
  const { result } = renderHook(() => useOutlineItemDocs(["missing"]), { wrapper });
  act(() => { store.dispatch(applyItemDocumentChange({ id: "missing", deleted: true })); });
  await act(async () => { finish({ rows: [{ doc: song("missing") }] }); await pending; });
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
  await act(async () => { finish({ rows: [{ doc: song("missing") }] }); await pending; });
  expect(result.current.get("missing")?.name).toBe("Newer");
});
