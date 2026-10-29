import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { ControllerInfoContext } from "../../context/controllerInfo";
import store from "../../store/store";
import { initiateItemLists, selectItemList, setOutlineScope, updateItemLists } from "../../store/itemListsSlice";
import { useLiveOutlinePreview } from "./useLiveOutlinePreview";

jest.mock("../../utils/formatItemList", () => ({
  formatItemList: (items: unknown[]) => items,
}));

const makeItem = (name: string) => ({
  listId: `${name}-row`,
  _id: `${name}-item`,
  name,
  type: "song",
});

const makeItemListsDoc = () => ({
  _id: "ItemLists",
  itemLists: [
    { _id: "main-list", name: "Main", controllerScope: "presentation" },
    { _id: "aux-list", name: "Aux", controllerScope: "aux-a" },
  ],
  activeList: { _id: "main-list", name: "Main" },
  selectedIdByScope: { presentation: "main-list", "aux-a": "aux-list" },
});

const initializeLocalRegistry = () => {
  store.dispatch({ type: "RESET" });
  store.dispatch(initiateItemLists(makeItemListsDoc().itemLists));
};

afterEach(() => store.dispatch({ type: "RESET" }));

describe("useLiveOutlinePreview", () => {
  it("loads the winning active outline when the workspace opens before Redux initializes outlines", async () => {
    store.dispatch({ type: "RESET" });
    expect(store.getState().undoable.present.itemLists.isInitialized).toBe(false);
    let resolveRegistry!: (value: ReturnType<typeof makeItemListsDoc>) => void;
    let resolveOutline!: (value: { _id: string; items: ReturnType<typeof makeItem>[] }) => void;
    const db = {
      get: jest.fn((id: string) => id === "ItemLists"
        ? new Promise<ReturnType<typeof makeItemListsDoc>>((resolve) => { resolveRegistry = resolve; })
        : new Promise<{ _id: string; items: ReturnType<typeof makeItem>[] }>((resolve) => { resolveOutline = resolve; })),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <ControllerInfoContext.Provider
          value={{ db, cloud: {} as never, updater: new EventTarget() } as never}
        >
          {children}
        </ControllerInfoContext.Provider>
      </Provider>
    );

    const { result, rerender } = renderHook(() => useLiveOutlinePreview(), { wrapper });
    await waitFor(() => expect(db.get).toHaveBeenCalledWith("ItemLists"));
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      resolveRegistry(makeItemListsDoc());
      await Promise.resolve();
    });
    await waitFor(() => expect(db.get).toHaveBeenCalledWith("main-list"));
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      resolveOutline({ _id: "main-list", items: [makeItem("Main item")] });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.items[0]?.name).toBe("Main item"));
    expect(result.current.isLoading).toBe(false);
    rerender();

    expect(db.get.mock.calls.filter(([id]) => id === "ItemLists")).toHaveLength(1);
    expect(db.get).toHaveBeenCalledWith("main-list");
  });

  it("uses the local outline registry for an initialized auxiliary scope", async () => {
    initializeLocalRegistry();
    const db = {
      get: jest.fn(async (id: string) =>
        ({ _id: id, items: [makeItem(id === "aux-list" ? "Aux item" : "Main item")] }),
      ),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <ControllerInfoContext.Provider
          value={{ db, cloud: {} as never, updater: new EventTarget() } as never}
        >
          {children}
        </ControllerInfoContext.Provider>
      </Provider>
    );

    const { result } = renderHook(() => useLiveOutlinePreview("aux-a"), { wrapper });
    await waitFor(() => expect(result.current.items[0]?.name).toBe("Aux item"));
    expect(db.get).toHaveBeenCalledTimes(1);
    expect(db.get).toHaveBeenCalledWith("aux-list");
    expect(db.get).not.toHaveBeenCalledWith("ItemLists");
  });

  it("follows remote live-outline switches from the winning fallback registry before Redux initializes", async () => {
    store.dispatch({ type: "RESET" });
    const original = makeItemListsDoc();
    const nextOutline = { _id: "next-main", name: "Next main", controllerScope: "presentation" };
    let registry = { ...original, itemLists: [...original.itemLists, nextOutline] };
    let resolveNext!: (value: { items: ReturnType<typeof makeItem>[] }) => void;
    const db = {
      get: jest.fn((id: string) => {
        if (id === "ItemLists") return Promise.resolve(registry);
        if (id === nextOutline._id) return new Promise((resolve) => { resolveNext = resolve; });
        return Promise.resolve({ items: [makeItem("Original live item")] });
      }),
    };
    const updater = new EventTarget();
    const cloud = {} as never;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <ControllerInfoContext.Provider value={{ db, cloud, updater } as never}>
          {children}
        </ControllerInfoContext.Provider>
      </Provider>
    );
    const { result } = renderHook(() => useLiveOutlinePreview(), { wrapper });
    await waitFor(() => expect(result.current.items[0]?.name).toBe("Original live item"));
    expect(result.current.isLoading).toBe(false);

    // The notification may describe a losing revision; Pouch's winner is authoritative.
    registry = { ...registry, activeList: nextOutline };
    act(() => updater.dispatchEvent(new CustomEvent("update", { detail: [original] })));
    await waitFor(() => expect(db.get).toHaveBeenCalledWith("next-main"));
    expect(result.current.isLoading).toBe(true);
    await act(async () => { resolveNext({ items: [makeItem("New live item")] }); });
    expect(result.current.items[0]?.name).toBe("New live item");
    expect(result.current.isLoading).toBe(false);
    expect(store.getState().undoable.present.itemLists.isInitialized).toBe(false);

    const readsBefore = db.get.mock.calls.length;
    registry = { ...registry, itemLists: registry.itemLists.map((list) => ({ ...list, name: `${list.name} renamed` })) };
    await act(async () => updater.dispatchEvent(new CustomEvent("update", { detail: [{ _id: "ItemLists" }] })));
    expect(db.get).toHaveBeenCalledTimes(readsBefore + 1);
    expect(db.get.mock.calls.filter(([id]) => id === "next-main")).toHaveLength(1);
    expect(result.current.items[0]?.name).toBe("New live item");
    expect(result.current.isLoading).toBe(false);
  });

  it("ignores superseded fallback registry reads and late results after unmount", async () => {
    store.dispatch({ type: "RESET" });
    const registryReads: Array<(value: ReturnType<typeof makeItemListsDoc>) => void> = [];
    const db = {
      get: jest.fn((id: string) => id === "ItemLists"
        ? new Promise((resolve) => { registryReads.push(resolve); })
        : Promise.resolve({ items: [makeItem(id)] })),
    };
    const updater = new EventTarget();
    const cloud = {} as never;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <ControllerInfoContext.Provider value={{ db, cloud, updater } as never}>
          {children}
        </ControllerInfoContext.Provider>
      </Provider>
    );
    const { result, unmount } = renderHook(() => useLiveOutlinePreview(), { wrapper });
    const notify = () => updater.dispatchEvent(new CustomEvent("update", { detail: [{ _id: "ItemLists" }] }));
    act(() => { notify(); });
    expect(registryReads).toHaveLength(2);
    const next = { _id: "next-main", name: "Next main", controllerScope: "presentation" };
    const winner = { ...makeItemListsDoc(), itemLists: [next], activeList: next };
    await act(async () => { registryReads[1](winner); });
    await waitFor(() => expect(result.current.items[0]?.name).toBe("next-main"));
    await act(async () => { registryReads[0](makeItemListsDoc()); });
    expect(result.current.items[0]?.name).toBe("next-main");
    expect(db.get).not.toHaveBeenCalledWith("main-list");

    act(() => { notify(); });
    expect(registryReads).toHaveLength(3);
    unmount();
    await act(async () => { registryReads[2](makeItemListsDoc()); });
    act(() => { notify(); });
    expect(registryReads).toHaveLength(3);
    expect(db.get).not.toHaveBeenCalledWith("main-list");
  });

  it("ignores a stale outline response after switching controller scopes", async () => {
    initializeLocalRegistry();
    let resolveMain!: (value: { _id: string; items: ReturnType<typeof makeItem>[] }) => void;
    const db = {
      get: jest.fn((id: string) => {
        if (id === "ItemLists") return Promise.resolve(makeItemListsDoc());
        if (id === "main-list") {
          return new Promise((resolve) => {
            resolveMain = resolve;
          });
        }
        return Promise.resolve({ _id: id, items: [makeItem("Aux current")] });
      }),
    };
    const updater = new EventTarget();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <ControllerInfoContext.Provider value={{ db, cloud: {} as never, updater } as never}>
          {children}
        </ControllerInfoContext.Provider>
      </Provider>
    );
    const { result, rerender } = renderHook(
      ({ scope }) => useLiveOutlinePreview(scope),
      { initialProps: { scope: "presentation" }, wrapper },
    );

    await waitFor(() => expect(db.get).toHaveBeenCalledWith("main-list"));
    rerender({ scope: "aux-a" });
    await waitFor(() => expect(result.current.items[0]?.name).toBe("Aux current"));
    await act(async () => {
      resolveMain({ _id: "main-list", items: [makeItem("Stale main")] });
    });
    expect(result.current.items[0]?.name).toBe("Aux current");
  });

  it("refreshes only the selected outline and removes its listener on unmount", async () => {
    initializeLocalRegistry();
    const itemListsDoc = makeItemListsDoc();
    const db = {
      get: jest.fn(async (id: string) =>
        id === "ItemLists"
          ? itemListsDoc
          : { _id: id, items: [makeItem(id === "aux-next" ? "Next aux item" : "Aux item")] },
      ),
    };
    const updater = new EventTarget();
    const removeSpy = jest.spyOn(updater, "removeEventListener");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <ControllerInfoContext.Provider value={{ db, cloud: {} as never, updater } as never}>
          {children}
        </ControllerInfoContext.Provider>
      </Provider>
    );
    const { unmount } = renderHook(() => useLiveOutlinePreview("aux-a"), { wrapper });
    await waitFor(() => expect(db.get).toHaveBeenCalledWith("aux-list"));
    const selectedReadCount = db.get.mock.calls.filter(([id]) => id === "aux-list").length;
    act(() => {
      updater.dispatchEvent(
        new CustomEvent("update", { detail: [{ _id: "aux-list" }] }),
      );
    });
    await waitFor(() =>
      expect(db.get.mock.calls.filter(([id]) => id === "aux-list").length).toBe(
        selectedReadCount + 1,
      ),
    );
    itemListsDoc.itemLists.push({
      _id: "aux-next",
      name: "Aux next",
      controllerScope: "aux-a",
    });
    act(() => {
      updater.dispatchEvent(
        new CustomEvent("update", {
          detail: [
            { ...itemListsDoc, itemLists: [...itemListsDoc.itemLists, { _id: "aux-next", name: "Aux next", controllerScope: "aux-a" }], selectedIdByScope: { "aux-a": "aux-next" } },
            { _id: "aux-list" },
          ],
        }),
      );
    });
    expect(db.get).not.toHaveBeenCalledWith("aux-next");
    act(() => {
      store.dispatch(setOutlineScope("aux-a"));
      store.dispatch(updateItemLists([...itemListsDoc.itemLists, { _id: "aux-next", name: "Aux next", controllerScope: "aux-a" }]));
      store.dispatch(selectItemList("aux-next"));
    });
    await waitFor(() => expect(db.get).toHaveBeenCalledWith("aux-next"));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("update", expect.any(Function));
    const readsAfterUnmount = db.get.mock.calls.length;
    act(() => {
      updater.dispatchEvent(
        new CustomEvent("update", { detail: [{ _id: "aux-list" }] }),
      );
    });
    expect(db.get).toHaveBeenCalledTimes(readsAfterUnmount);
  });

  it("keeps preview data and avoids outline reads for an unchanged registry selection", async () => {
    initializeLocalRegistry();
    const itemListsDoc = makeItemListsDoc();
    const db = {
      get: jest.fn(async (id: string) =>
        id === "ItemLists"
          ? itemListsDoc
          : { _id: id, items: [makeItem("Current aux item")] },
      ),
    };
    const updater = new EventTarget();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <ControllerInfoContext.Provider value={{ db, cloud: {} as never, updater } as never}>
          {children}
        </ControllerInfoContext.Provider>
      </Provider>
    );
    const { result } = renderHook(() => useLiveOutlinePreview("aux-a"), { wrapper });
    await waitFor(() => expect(result.current.items[0]?.name).toBe("Current aux item"));
    const readsBefore = db.get.mock.calls.length;
    itemListsDoc.itemLists[0].name = "Renamed main outline";

    act(() => updater.dispatchEvent(new CustomEvent("update", {
      detail: [itemListsDoc],
    })));

    expect(db.get).toHaveBeenCalledTimes(readsBefore);
    expect(result.current.items[0]?.name).toBe("Current aux item");
    expect(result.current.isLoading).toBe(false);
  });

  it("retains displayed data without a skeleton while the same outline refreshes", async () => {
    initializeLocalRegistry();
    let resolveRefresh!: (value: { _id: string; items: ReturnType<typeof makeItem>[] }) => void;
    let auxReads = 0;
    const db = {
      get: jest.fn((id: string) => {
        if (id === "ItemLists") return Promise.resolve(makeItemListsDoc());
        auxReads += 1;
        if (auxReads === 1) {
          return Promise.resolve({ _id: id, items: [makeItem("Before refresh")] });
        }
        return new Promise((resolve) => { resolveRefresh = resolve; });
      }),
    };
    const updater = new EventTarget();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>
        <ControllerInfoContext.Provider value={{ db, cloud: {} as never, updater } as never}>
          {children}
        </ControllerInfoContext.Provider>
      </Provider>
    );
    const { result } = renderHook(() => useLiveOutlinePreview("aux-a"), { wrapper });
    await waitFor(() => expect(result.current.items[0]?.name).toBe("Before refresh"));

    act(() => updater.dispatchEvent(new CustomEvent("update", {
      detail: [{ _id: "aux-list", _rev: "2-content" }],
    })));
    expect(result.current.items[0]?.name).toBe("Before refresh");
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      resolveRefresh({ _id: "aux-list", items: [makeItem("After refresh")] });
      await Promise.resolve();
    });
    expect(result.current.items[0]?.name).toBe("After refresh");
    expect(result.current.isLoading).toBe(false);
  });
});
