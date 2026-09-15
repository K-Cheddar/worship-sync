import React from "react";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import store from "../../store/store";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { itemListsSlice } from "../../store/itemListsSlice";
import { ActiveControllerProvider } from "../../context/activeController";
import { useControllerPageLifecycle } from "./useControllerPageLifecycle";

jest.mock("../../hooks", () => ({
  useDispatch: () => store.dispatch,
  useSelector: (selector: (state: unknown) => unknown) =>
    selector(store.getState()),
  useSyncOnReconnect: jest.fn(),
}));

jest.mock("../../hooks/useGlobalBroadcast", () => ({
  useGlobalBroadcast: jest.fn(),
}));

jest.mock("../../context/toastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock("../../utils/controllerBootstrapDocs", () => ({
  loadOrCreateAllItemsDoc: jest.fn().mockResolvedValue({ items: [] }),
  loadOrCreatePreferencesBundle: jest.fn().mockResolvedValue({
    preferences: {},
    quickLinks: [],
    monitorSettings: {},
    mediaRouteFolders: [],
  }),
}));

jest.mock("../../utils/mediaDocUtils", () => ({
  loadOrCreateMediaDoc: jest.fn(),
  normalizeMediaDoc: jest.fn(),
}));

jest.mock("../../utils/formatItemList", () => ({
  formatItemList: (items: unknown[]) => items,
}));

jest.mock("../../utils/dbUtils", () => ({
  deleteUnusedBibleItems: jest.fn(),
  deleteUnusedHeadings: jest.fn(),
  getAllOverlayHistory: jest.fn().mockResolvedValue([]),
  getOverlaysByIds: jest.fn().mockResolvedValue([]),
  updateAllDocs: jest.fn(),
  migrateMediaLibraryFoldersFieldIfNeeded: jest.fn(),
}));

jest.mock("firebase/database", () => ({
  onValue: jest.fn(),
  ref: jest.fn(),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const details = (name: string) => ({
  items: [{ _id: name, name, type: "song" }],
  overlays: [],
});

const createDb = (
  loads: Record<string, Deferred<ReturnType<typeof details>>>,
) => ({
  get: jest.fn((id: string) => loads[id]?.promise ?? Promise.resolve(undefined)),
} as any);

describe("useControllerPageLifecycle selected outline loading", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_CONTROLLER_SESSION" });
  });

  it("keeps the newer outline when the stale request resolves afterward", async () => {
    const loadA = deferred<ReturnType<typeof details>>();
    const loadB = deferred<ReturnType<typeof details>>();
    const db = createDb({ a: loadA, b: loadB });

    store.dispatch(
      itemListsSlice.actions.initiateItemLists([
        { _id: "a", name: "A" },
        { _id: "b", name: "B" },
      ]),
    );

    const { rerender } = renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {} } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });

    store.dispatch(itemListsSlice.actions.selectItemList("b"));
    rerender();

    await act(async () => {
      loadB.resolve(details("B"));
      await loadB.promise;
    });
    await act(async () => {
      loadA.resolve(details("A"));
      await loadA.promise;
    });

    expect(store.getState().undoable.present.itemList.list).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "B" })]),
    );
    expect(store.getState().undoable.present.itemList.list).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "A" })]),
    );
    expect(store.getState().undoable.present.itemList.isLoading).toBe(false);
  });

  it("initializes the newer outline when the older request resolves first", async () => {
    const loadA = deferred<ReturnType<typeof details>>();
    const loadB = deferred<ReturnType<typeof details>>();
    const db = createDb({ a: loadA, b: loadB });

    store.dispatch(
      itemListsSlice.actions.initiateItemLists([
        { _id: "a", name: "A" },
        { _id: "b", name: "B" },
      ]),
    );

    const { rerender } = renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {} } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });

    store.dispatch(itemListsSlice.actions.selectItemList("b"));
    rerender();

    await act(async () => {
      loadA.resolve(details("A"));
      await loadA.promise;
      loadB.resolve(details("B"));
      await loadB.promise;
    });

    expect(store.getState().undoable.present.itemList.list).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "B" })]),
    );
    expect(store.getState().undoable.present.itemList.list).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "A" })]),
    );
    expect(store.getState().undoable.present.itemList.isLoading).toBe(false);
  });

  it("does not reset an aux scope when lifecycle callback identities change", () => {
    const db = createDb({});
    let globalInfoValue = { refreshPresentationListeners: jest.fn() };
    const dispatchSpy = jest.spyOn(store, "dispatch");

    store.dispatch(
      itemListsSlice.actions.initiateItemLists([
        { _id: "presentation", name: "Service Outline" },
        { _id: "aux", name: "Sabbath Service", controllerScope: "aux" },
      ]),
    );

    const { rerender, unmount } = renderHook(
      () => useControllerPageLifecycle(),
      {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <GlobalInfoContext.Provider value={globalInfoValue as any}>
              <ControllerInfoContext.Provider value={{ db, cloud: {} } as any}>
                <ActiveControllerProvider profileId="aux">
                  {children}
                </ActiveControllerProvider>
              </ControllerInfoContext.Provider>
            </GlobalInfoContext.Provider>
          </Provider>
        ),
      },
    );

    dispatchSpy.mockClear();
    globalInfoValue = { refreshPresentationListeners: jest.fn() };
    rerender();

    expect(
      dispatchSpy.mock.calls.some(([action]) => action.type === "RESET_CONTROLLER_SESSION"),
    ).toBe(false);
    expect(store.getState().undoable.present.itemLists.scope).toBe("aux");
    expect(store.getState().undoable.present.itemLists.selectedList?._id).toBe(
      "aux",
    );

    unmount();

    expect(
      dispatchSpy.mock.calls.filter(
        ([action]) => action.type === "RESET_CONTROLLER_SESSION",
      ),
    ).toHaveLength(1);
    dispatchSpy.mockRestore();
  });
});
