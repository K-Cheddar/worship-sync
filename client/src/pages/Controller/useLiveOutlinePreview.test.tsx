import { act, renderHook, waitFor } from "@testing-library/react";
import { ControllerInfoContext } from "../../context/controllerInfo";
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

describe("useLiveOutlinePreview", () => {
  it("loads the active Presentation outline ahead of a different persisted selection", async () => {
    const itemListsDoc = makeItemListsDoc();
    itemListsDoc.itemLists.push({
      _id: "saved-list",
      name: "Previously selected",
      controllerScope: "presentation",
    });
    itemListsDoc.selectedIdByScope.presentation = "saved-list";
    const activeItems = Array.from({ length: 20 }, (_, index) =>
      makeItem(`Active item ${index + 1}`),
    );
    const db = {
      get: jest.fn(async (id: string) =>
        id === "ItemLists"
          ? itemListsDoc
          : {
              _id: id,
              items:
                id === "main-list"
                  ? activeItems
                  : [makeItem("Previously selected item 1"), makeItem("Previously selected item 2")],
            },
      ),
      put: jest.fn(),
    };
    const updater = new EventTarget();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ControllerInfoContext.Provider
        value={{ db, cloud: {} as never, updater, bootstrapReady: true } as never}
      >
        {children}
      </ControllerInfoContext.Provider>
    );

    const { result } = renderHook(() => useLiveOutlinePreview(), { wrapper });

    await waitFor(() => expect(result.current.items).toHaveLength(20));
    expect(result.current.items[0]?.name).toBe("Active item 1");
    expect(db.get).toHaveBeenCalledWith("main-list");
    expect(db.get).not.toHaveBeenCalledWith("saved-list");
    expect(db.put).not.toHaveBeenCalled();
  });

  it("follows active Presentation outline changes while leaving the saved selection alone", async () => {
    const itemListsDoc = makeItemListsDoc();
    itemListsDoc.itemLists.push({
      _id: "next-main-list",
      name: "Next Main",
      controllerScope: "presentation",
    });
    itemListsDoc.selectedIdByScope.presentation = "aux-list";
    const db = {
      get: jest.fn(async (id: string) =>
        id === "ItemLists"
          ? itemListsDoc
          : { _id: id, items: [makeItem(id === "next-main-list" ? "New active item" : "Old item")] },
      ),
    };
    const updater = new EventTarget();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ControllerInfoContext.Provider
        value={{ db, cloud: {} as never, updater, bootstrapReady: true } as never}
      >
        {children}
      </ControllerInfoContext.Provider>
    );
    const { result } = renderHook(() => useLiveOutlinePreview(), { wrapper });
    await waitFor(() => expect(result.current.items[0]?.name).toBe("Old item"));

    itemListsDoc.activeList = { _id: "next-main-list", name: "Next Main" } as never;
    act(() => {
      updater.dispatchEvent(
        new CustomEvent("update", { detail: [{ _id: "ItemLists" }] }),
      );
    });

    await waitFor(() => expect(result.current.items[0]?.name).toBe("New active item"));
    expect(db.get).toHaveBeenCalledWith("next-main-list");
    expect(itemListsDoc.selectedIdByScope.presentation).toBe("aux-list");
  });

  it("uses the saved Presentation selection when the church active outline is invalid", async () => {
    const itemListsDoc = makeItemListsDoc();
    itemListsDoc.itemLists.push({
      _id: "saved-list",
      name: "Saved Presentation",
      controllerScope: "presentation",
    });
    itemListsDoc.activeList = { _id: "aux-list", name: "Aux" } as never;
    itemListsDoc.selectedIdByScope.presentation = "saved-list";
    const db = {
      get: jest.fn(async (id: string) =>
        id === "ItemLists"
          ? itemListsDoc
          : { _id: id, items: [makeItem(id === "saved-list" ? "Saved item" : "Wrong scope item")] },
      ),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ControllerInfoContext.Provider
        value={{ db, cloud: {} as never, updater: new EventTarget() } as never}
      >
        {children}
      </ControllerInfoContext.Provider>
    );

    const { result } = renderHook(() => useLiveOutlinePreview(), { wrapper });

    await waitFor(() => expect(result.current.items[0]?.name).toBe("Saved item"));
    expect(db.get).toHaveBeenCalledWith("saved-list");
    expect(db.get).not.toHaveBeenCalledWith("aux-list");
  });

  it("refreshes cached items when initial replication becomes ready", async () => {
    let bootstrapReady = false;
    let remoteReplicationComplete = false;
    const db = {
      get: jest.fn(async (id: string) =>
        id === "ItemLists"
          ? makeItemListsDoc()
          : {
              _id: id,
              items: Array.from(
                { length: remoteReplicationComplete ? 20 : 2 },
                (_, index) => makeItem(`Replicated item ${index + 1}`),
              ),
            },
      ),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ControllerInfoContext.Provider
        value={{ db, cloud: {} as never, updater: new EventTarget(), bootstrapReady } as never}
      >
        {children}
      </ControllerInfoContext.Provider>
    );
    const { result, rerender } = renderHook(() => useLiveOutlinePreview(), { wrapper });

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    remoteReplicationComplete = true;
    bootstrapReady = true;
    rerender();

    await waitFor(() => expect(result.current.items).toHaveLength(20));
    expect(db.get.mock.calls.filter(([id]) => id === "main-list")).toHaveLength(2);
  });

  it("loads a controller's persisted selected outline without its controller page", async () => {
    const db = {
      get: jest.fn(async (id: string) =>
        id === "ItemLists"
          ? makeItemListsDoc()
          : { _id: id, items: [makeItem(id === "aux-list" ? "Aux item" : "Main item")] },
      ),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ControllerInfoContext.Provider
        value={{ db, cloud: {} as never, updater: new EventTarget() } as never}
      >
        {children}
      </ControllerInfoContext.Provider>
    );

    const { result } = renderHook(() => useLiveOutlinePreview("aux-a"), { wrapper });
    await waitFor(() => expect(result.current.items[0]?.name).toBe("Aux item"));
    expect(db.get).toHaveBeenCalledWith("aux-list");
  });

  it("ignores a stale outline response after switching controller scopes", async () => {
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
      <ControllerInfoContext.Provider
        value={{ db, cloud: {} as never, updater } as never}
      >
        {children}
      </ControllerInfoContext.Provider>
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

  it("ignores an older outline response after a newer active outline update", async () => {
    const itemListsDoc = makeItemListsDoc();
    itemListsDoc.itemLists.push({
      _id: "next-main-list",
      name: "Next Main",
      controllerScope: "presentation",
    });
    let resolveOldOutline!: (value: {
      _id: string;
      items: ReturnType<typeof makeItem>[];
    }) => void;
    const db = {
      get: jest.fn((id: string) => {
        if (id === "ItemLists") return Promise.resolve(itemListsDoc);
        if (id === "main-list") {
          return new Promise((resolve) => {
            resolveOldOutline = resolve;
          });
        }
        return Promise.resolve({ _id: id, items: [makeItem("New active item")] });
      }),
    };
    const updater = new EventTarget();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ControllerInfoContext.Provider
        value={{ db, cloud: {} as never, updater } as never}
      >
        {children}
      </ControllerInfoContext.Provider>
    );
    const { result } = renderHook(() => useLiveOutlinePreview(), { wrapper });

    await waitFor(() => expect(db.get).toHaveBeenCalledWith("main-list"));
    itemListsDoc.activeList = { _id: "next-main-list", name: "Next Main" };
    act(() => {
      updater.dispatchEvent(
        new CustomEvent("update", { detail: [{ _id: "ItemLists" }] }),
      );
    });
    await waitFor(() =>
      expect(result.current.items[0]?.name).toBe("New active item"),
    );

    await act(async () => {
      resolveOldOutline({ _id: "main-list", items: [makeItem("Stale item")] });
    });

    expect(result.current.items[0]?.name).toBe("New active item");
  });

  it("refreshes only the selected outline and removes its listener on unmount", async () => {
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
      <ControllerInfoContext.Provider
        value={{ db, cloud: {} as never, updater } as never}
      >
        {children}
      </ControllerInfoContext.Provider>
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
    itemListsDoc.selectedIdByScope["aux-a"] = "aux-next";
    act(() => {
      updater.dispatchEvent(
        new CustomEvent("update", {
          detail: [{ _id: "ItemLists" }, { _id: "aux-list" }],
        }),
      );
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
});
