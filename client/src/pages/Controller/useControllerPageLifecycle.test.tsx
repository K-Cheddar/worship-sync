import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import store from "../../store/store";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { itemListsSlice } from "../../store/itemListsSlice";
import { markServicePlanningPlanPreviewStale } from "../../store/servicePlanningImportSlice";
import { initiateMediaFromDoc } from "../../store/mediaSlice";
import { loadMediaLibrary as readMediaLibrary } from "../../utils/mediaDocUtils";
import { ActiveControllerProvider } from "../../context/activeController";
import { useControllerPageLifecycle } from "./useControllerPageLifecycle";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import { upsertMediaItemFromRemote } from "../../store/mediaSlice";
import { updateAllDocs } from "../../utils/dbUtils";

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
  loadMediaLibrary: jest.fn().mockResolvedValue({ list: [], folders: [] }),
  requireMediaLibraryV2: jest.fn().mockResolvedValue(undefined),
  parseMediaReplicationDoc: jest.requireActual("../../utils/mediaDocUtils").parseMediaReplicationDoc,
}));

jest.mock("../../utils/formatItemList", () => ({
  formatItemList: (items: unknown[]) => items,
}));

jest.mock("../../utils/dbUtils", () => ({
  invalidateLibraryRefresh: jest.fn(),
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
    jest.mocked(useGlobalBroadcast).mockClear();
    jest.mocked(readMediaLibrary).mockResolvedValue({ list: [], folders: [] });
    jest.mocked(updateAllDocs).mockClear();
  });

  it("does not scan the library for v2 slide/arrangement/cleanup notifications", () => {
    const db = createDb({});
    const updater = new EventTarget();
    renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {}, updater } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });
    jest.mocked(updateAllDocs).mockClear();
    act(() => updater.dispatchEvent(new CustomEvent("update", { detail: [
      { _id: "song-v2:slide:better:master:verse-a", docType: "song-v2-slide" },
      { _id: "song-v2:arrangement:better:master", docType: "song-v2-arrangement" },
      { _id: "song-v2:cleanup:better:old", docType: "song-v2-cleanup" },
    ] })));
    expect(updateAllDocs).not.toHaveBeenCalled();
    act(() => updater.dispatchEvent(new CustomEvent("update", { detail: [{ _id: "legacy", type: "free" }] })));
    expect(updateAllDocs).toHaveBeenCalledTimes(1);
  });

  it("applies replicated media item changes to Redux outside the media route", () => {
    const db = createDb({});
    const updater = new EventTarget();

    renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {}, updater } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });

    act(() => {
      store.dispatch(initiateMediaFromDoc({
        list: [{ id: "existing", name: "Existing" }] as any,
        folders: [],
      }));
      updater.dispatchEvent(new CustomEvent("update", {
        detail: [{ _id: "media-item:new", id: "new", docType: "mediaItem", name: "New item" }],
      }));
    });

    expect(store.getState().media.list).toEqual([
      { id: "existing", name: "Existing" },
      expect.objectContaining({ id: "new", name: "New item" }),
    ]);
  });

  it("does not clear saved-plan freshness when an outline is restored during controller loading", async () => {
    const outlineRead = deferred<any>();
    const documents = new Map<string, Record<string, unknown>>();
    const db = {
      get: jest.fn(async (id: string) => {
        if (id === "outline") return outlineRead.promise;
        const document = documents.get(id);
        if (document) return document;
        throw Object.assign(new Error("missing document"), { status: 404 });
      }),
      put: jest.fn(async (document: Record<string, unknown>) => {
        documents.set(document._id as string, document);
        return { ok: true, rev: "1-created" };
      }),
    } as any;
    const storedOutline = {
      source: "servicePlanning",
      loadedAt: "2026-05-03T12:00:00.000Z",
      sourceUrl: "https://example.com/legacy-outline",
      planLabel: "Legacy outline",
      preview: { lineItems: [], outlineCandidates: [], overlayCandidates: [] },
    };
    store.dispatch(
      itemListsSlice.actions.initiateItemLists([
        { _id: "outline", name: "Sunday AM" },
      ]),
    );
    store.dispatch(markServicePlanningPlanPreviewStale("saved-plan"));

    renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {} } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });

    await waitFor(() => expect(db.get).toHaveBeenCalledWith("outline"));
    await act(async () => {
      outlineRead.resolve({ ...details("Loaded outline"), serviceOutline: storedOutline });
      await outlineRead.promise;
      await Promise.resolve();
    });

    expect(store.getState().servicePlanningImport.serviceOutline).toBeNull();
    expect(store.getState().servicePlanningImport.preview).toBeNull();
    expect(store.getState().servicePlanningImport.isPlanPreviewStale).toBe(true);
  });

  it("routes the same replicated media document through Redux only once", () => {
    const db = createDb({});
    const updater = new EventTarget();
    const dispatchSpy = jest.spyOn(store, "dispatch");
    renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {}, updater } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });
    const mediaUpdate = {
      _id: "media-item:duplicate",
      _rev: "2-revision",
      id: "duplicate",
      docType: "mediaItem",
      name: "Replicated once",
    };
    const globalHandler = jest.mocked(useGlobalBroadcast).mock.calls[1][0] as (
      event: CustomEventInit,
    ) => void;
    act(() => {
      updater.dispatchEvent(new CustomEvent("update", { detail: [mediaUpdate] }));
      globalHandler({ detail: [mediaUpdate] });
    });

    expect(dispatchSpy.mock.calls.filter(([action]) => action.type === upsertMediaItemFromRemote.type)).toHaveLength(1);
    dispatchSpy.mockRestore();
  });

  it("ignores legacy aggregate media replication", async () => {
    const db = createDb({});
    const updater = new EventTarget();

    renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {}, updater } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });
    await act(async () => { await Promise.resolve(); });

    act(() => updater.dispatchEvent(new CustomEvent("update", {
      detail: [{ _id: "media", list: [{ id: "legacy", name: "Legacy" }], folders: [] }],
    })));

    expect(store.getState().media.list).toEqual([]);
  });

  it("re-reads the media library when an item replicates during its initial read", async () => {
    const initialRead = deferred<{ list: any[]; folders: any[] }>();
    const readStarted = deferred<void>();
    const latest = { list: [{ id: "replicated", name: "Replicated item" }], folders: [] };
    jest.mocked(readMediaLibrary)
      .mockImplementationOnce(() => {
        readStarted.resolve();
        return initialRead.promise;
      })
      .mockResolvedValueOnce(latest as any);
    const db = createDb({});
    const updater = new EventTarget();

    renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <GlobalInfoContext.Provider value={{ access: "full" } as any}>
            <ControllerInfoContext.Provider value={{ db, cloud: {}, updater } as any}>
              {children}
            </ControllerInfoContext.Provider>
          </GlobalInfoContext.Provider>
        </Provider>
      ),
    });

    await readStarted.promise;
    act(() => updater.dispatchEvent(new CustomEvent("update", {
      detail: [{ _id: "media-item:replicated", id: "replicated", docType: "mediaItem", name: "Replicated item" }],
    })));
    await act(async () => {
      initialRead.resolve({ list: [{ id: "stale", name: "Stale item" }], folders: [] });
      await initialRead.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readMediaLibrary).toHaveBeenCalledTimes(2);
    expect(store.getState().media.list).toEqual(latest.list);
  });

  it("ignores stale legacy aggregate media replication", async () => {
    const currentV2List = [{ id: "current", name: "Current v2 item" }] as any;
    jest.mocked(readMediaLibrary).mockResolvedValue({ list: currentV2List, folders: [] } as any);
    const db = createDb({});
    const updater = new EventTarget();

    renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <GlobalInfoContext.Provider value={{ access: "full" } as any}>
            <ControllerInfoContext.Provider value={{ db, cloud: {}, updater } as any}>
              {children}
            </ControllerInfoContext.Provider>
          </GlobalInfoContext.Provider>
        </Provider>
      ),
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    act(() => updater.dispatchEvent(new CustomEvent("update", {
      detail: [{ _id: "media", list: [{ id: "stale", name: "Stale v1 item" }], folders: [] }],
    })));

    expect(store.getState().media.list).toEqual(currentV2List);
  });

  it("applies v2 item add/update/delete and folder replication after the marker", () => {
    const db = createDb({});
    const updater = new EventTarget();
    const existingFolder = { id: "old-folder", name: "Old", parentId: null };

    renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {}, updater } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });
    store.dispatch(initiateMediaFromDoc({
      list: [
        { id: "update", name: "Before", folderId: "old-folder", thumbnail: "/old.jpg" },
        { id: "delete", name: "Remove" },
      ] as any,
      folders: [existingFolder] as any,
    }));

    act(() => updater.dispatchEvent(new CustomEvent("update", {
      detail: [
        { _id: "media-library-meta", schemaVersion: 2 },
        { _id: "media-item:update", id: "update", docType: "mediaItem", name: "After" },
        { _id: "media-item:add", id: "add", docType: "mediaItem", name: "New" },
        { _id: "media-item:delete", _deleted: true },
        { _id: "media-folders", folders: [{ id: "new-folder", name: "New", parentId: null }] },
      ],
    })));

    expect(store.getState().media.list).toEqual([
      { id: "update", name: "After" },
      { id: "add", name: "New" },
    ]);
    expect(store.getState().media.folders).toEqual([
      { id: "new-folder", name: "New", parentId: null },
    ]);
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
