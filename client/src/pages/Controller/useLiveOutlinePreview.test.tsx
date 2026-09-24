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
