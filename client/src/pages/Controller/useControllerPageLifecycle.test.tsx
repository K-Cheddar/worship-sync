import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import store from "../../store/store";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { itemListsSlice } from "../../store/itemListsSlice";
import { setItemListIsLoading } from "../../store/itemListSlice";
import { overlaySlice } from "../../store/overlaySlice";
import { overlaysSlice } from "../../store/overlaysSlice";
import { markServicePlanningPlanPreviewStale } from "../../store/servicePlanningImportSlice";
import { initiateMediaFromDoc } from "../../store/mediaSlice";
import { loadMediaLibrary as readMediaLibrary } from "../../utils/mediaDocUtils";
import { ActiveControllerProvider } from "../../context/activeController";
import { useControllerPageLifecycle } from "./useControllerPageLifecycle";
import { useGlobalBroadcast } from "../../hooks/useGlobalBroadcast";
import { upsertMediaItemFromRemote } from "../../store/mediaSlice";
import { getOverlaysByIds } from "../../utils/dbUtils";

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
  ...jest.requireActual("../../utils/dbUtils"),
  getAllOverlayHistory: jest.fn().mockResolvedValue([]),
  getOverlaysByIds: jest.fn().mockResolvedValue([]),
  migrateMediaLibraryFoldersFieldIfNeeded: jest.fn(),
}));

jest.mock("../../utils/controllerMediaRouteFolders", () => ({
  loadOrCreateControllerMediaRouteFolders: jest.fn().mockResolvedValue({
    mediaRouteFolders: {},
  }),
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
  put: jest.fn().mockResolvedValue({ ok: true, rev: "1-saved" }),
} as any);

describe("useControllerPageLifecycle selected outline loading", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET_CONTROLLER_SESSION" });
    jest.mocked(useGlobalBroadcast).mockClear();
    jest.mocked(getOverlaysByIds).mockReset().mockResolvedValue([]);
    jest.mocked(readMediaLibrary).mockResolvedValue({ list: [], folders: [] });
  });

  it.each([50, 100])("preserves newly created Bible and heading documents while outline references are pending (progress %s)", async (initialProgress) => {
    const outline = deferred<ReturnType<typeof details>>();
    const bible = { _id: "new-bible", _rev: "1-b", type: "bible", name: "John 3" };
    const heading = { _id: "new-heading", _rev: "1-h", type: "heading", name: "Welcome" };
    const persisted = new Map<string, unknown>([
      ["ItemLists", { _id: "ItemLists", itemLists: [{ _id: "outline" }] }],
      ["outline", { _id: "outline", docType: "itemListDetails", items: [] }],
      [bible._id, bible], [heading._id, heading],
    ]);
    const db = {
      ...createDb({ outline }),
      allDocs: jest.fn(async () => ({ rows: [...persisted.values()].map((doc) => ({ doc })) })),
      remove: jest.fn(async (doc: { _id: string }) => { persisted.delete(doc._id); }),
    };
    store.dispatch(itemListsSlice.actions.initiateItemLists([{ _id: "outline", name: "Sunday" }]));
    let dbProgress = initialProgress;
    const { rerender } = renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, dbProgress, cloud: {} } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });
    await waitFor(() => expect(db.get).toHaveBeenCalledWith("outline"));
    dbProgress = 100;
    rerender();
    await Promise.resolve();
    expect(db.remove).not.toHaveBeenCalled();
    expect(persisted.get(bible._id)).toEqual(bible);
    expect(persisted.get(heading._id)).toEqual(heading);
    await act(async () => { outline.resolve({ items: [bible, heading], overlays: [] }); });
    await waitFor(() => expect(store.getState().undoable.present.itemList.list).toEqual([
      expect.objectContaining(bible), expect.objectContaining(heading),
    ]));
    expect(db.remove).not.toHaveBeenCalled();
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

  it("updates a remote outline without reloading unchanged overlay content", async () => {
    const overlay = {
      id: "overlay-1",
      type: "participant",
      name: "Current overlay",
      title: "",
      event: "",
      duration: 7,
    };
    const db = {
      get: jest.fn().mockResolvedValue({
        _id: "outline",
        items: [{ _id: "song-1", name: "Before", type: "song" }],
        overlays: ["overlay-1"],
      }),
      put: jest.fn().mockResolvedValue({ ok: true, rev: "1-saved" }),
    } as any;
    const updater = new EventTarget();
    jest.mocked(getOverlaysByIds).mockResolvedValue([overlay] as any);
    store.dispatch(
      itemListsSlice.actions.initiateItemLists([
        { _id: "outline", name: "Sunday" },
      ]),
    );

    renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {}, updater } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });

    await waitFor(() => {
      expect(store.getState().undoable.present.overlays.list).toEqual([
        expect.objectContaining({ id: "overlay-1", name: "Current overlay" }),
      ]);
    });
    jest.mocked(getOverlaysByIds).mockClear();

    await act(async () => {
      updater.dispatchEvent(
        new CustomEvent("update", {
          detail: [
            {
              _id: "outline",
              _rev: "2-items-only",
              items: [{ _id: "song-2", name: "After", type: "song" }],
              overlays: ["overlay-1"],
            },
          ],
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.getState().undoable.present.itemList.list).toEqual([
      expect.objectContaining({ _id: "song-2", name: "After" }),
    ]);
    expect(store.getState().undoable.present.overlays.list).toEqual([
      expect.objectContaining({ id: "overlay-1", name: "Current overlay" }),
    ]);
    expect(getOverlaysByIds).not.toHaveBeenCalled();
  });

  it("does not reread or show a loading skeleton when the selected outline is only renamed remotely", async () => {
    const db = {
      get: jest.fn(async (id: string) =>
        id === "outline" ? details("Loaded outline") : undefined,
      ),
      put: jest.fn().mockResolvedValue({ ok: true, rev: "1-saved" }),
    } as any;
    store.dispatch(
      itemListsSlice.actions.initiateItemLists([
        { _id: "outline", name: "Sunday" },
      ]),
    );
    const dispatchSpy = jest.spyOn(store, "dispatch");
    const { rerender } = renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {} } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });

    await waitFor(() => expect(db.get).toHaveBeenCalledWith("outline"));
    await waitFor(() =>
      expect(store.getState().undoable.present.itemList.isLoading).toBe(false),
    );
    dispatchSpy.mockClear();
    db.get.mockClear();

    act(() => {
      store.dispatch(
        itemListsSlice.actions.updateItemListsFromRemote({
          itemLists: [{ _id: "outline", name: "Renamed Sunday" }],
        }),
      );
    });
    rerender();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(db.get).not.toHaveBeenCalledWith("outline");
    expect(dispatchSpy).not.toHaveBeenCalledWith(setItemListIsLoading(true));
    expect(store.getState().undoable.present.itemList.list).toEqual([
      expect.objectContaining({ name: "Loaded outline" }),
    ]);
    dispatchSpy.mockRestore();
  });

  it("does not initialize an empty outline after repeated invalidated reads", async () => {
    const reads = Array.from({ length: 5 }, () => deferred<ReturnType<typeof details>>());
    let readIndex = 0;
    const db = {
      get: jest.fn((id: string) => id === "outline"
        ? reads[readIndex++].promise
        : Promise.resolve(undefined)),
      put: jest.fn().mockResolvedValue({ ok: true, rev: "1-saved" }),
    } as any;
    const updater = new EventTarget();
    store.dispatch(itemListsSlice.actions.initiateItemLists([
      { _id: "outline", name: "Sunday" },
    ]));

    renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {}, updater } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });

    for (let attempt = 0; attempt < reads.length; attempt += 1) {
      await waitFor(() => expect(db.get.mock.calls.filter((call: [string]) => call[0] === "outline"))
        .toHaveLength(attempt + 1));
      await act(async () => {
        updater.dispatchEvent(new CustomEvent("update", {
          detail: [{ _id: "outline", items: [], overlays: [] }],
        }));
        reads[attempt].resolve(details(`stale-${attempt}`));
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    await waitFor(() => expect(store.getState().undoable.present.itemList.isLoading).toBe(false));
    expect(db.get.mock.calls.filter((call: [string]) => call[0] === "outline")).toHaveLength(5);
    expect(store.getState().undoable.present.itemList.isInitialized).toBe(false);
    expect(store.getState().undoable.present.itemList.list).toEqual([]);
    expect(store.getState().undoable.present.itemList.loadError).toMatch(/kept changing while it loaded/);
  });

  it("initializes a genuinely empty outline from a stable database read", async () => {
    const db = {
      get: jest.fn().mockResolvedValue({ _id: "outline", items: [], overlays: [] }),
      put: jest.fn().mockResolvedValue({ ok: true, rev: "1-saved" }),
    } as any;
    store.dispatch(itemListsSlice.actions.initiateItemLists([
      { _id: "outline", name: "Sunday" },
    ]));

    renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {} } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });

    await waitFor(() => expect(store.getState().undoable.present.itemList.isLoading).toBe(false));
    expect(store.getState().undoable.present.itemList.isInitialized).toBe(true);
    expect(store.getState().undoable.present.itemList.list).toEqual([]);
    expect(store.getState().undoable.present.itemList.loadError).toBeNull();
  });

  it("shows a load error instead of initializing empty content after a failed read", async () => {
    const db = {
      get: jest.fn((id: string) => id === "outline"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(undefined)),
      put: jest.fn().mockResolvedValue({ ok: true, rev: "1-saved" }),
    } as any;
    store.dispatch(itemListsSlice.actions.initiateItemLists([
      { _id: "outline", name: "Sunday" },
    ]));

    renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {} } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });

    await waitFor(() => expect(store.getState().undoable.present.itemList.isLoading).toBe(false));
    expect(store.getState().undoable.present.itemList.isInitialized).toBe(false);
    expect(store.getState().undoable.present.itemList.loadError)
      .toBe("Could not load this outline. Check the connection and try again.");
    expect(store.getState().undoable.present.itemList.list).toEqual([]);
  });

  it("ignores an outline response after switching to another outline", async () => {
    const oldRead = deferred<ReturnType<typeof details>>();
    const db = {
      get: jest.fn((id: string) => id === "outline-a"
        ? oldRead.promise
        : Promise.resolve(details("Outline B"))),
      put: jest.fn().mockResolvedValue({ ok: true, rev: "1-saved" }),
    } as any;
    store.dispatch(itemListsSlice.actions.initiateItemLists([
      { _id: "outline-a", name: "Sunday" },
      { _id: "outline-b", name: "Wednesday" },
    ]));
    const { rerender } = renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {} } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });
    await waitFor(() => expect(db.get).toHaveBeenCalledWith("outline-a"));

    act(() => store.dispatch(itemListsSlice.actions.selectItemList("outline-b")));
    rerender();
    await waitFor(() => expect(store.getState().undoable.present.itemList.list)
      .toEqual([expect.objectContaining({ name: "Outline B" })]));
    await act(async () => { oldRead.resolve(details("Stale outline A")); });

    expect(store.getState().undoable.present.itemList.loadedOutlineId).toBe("outline-b");
    expect(store.getState().undoable.present.itemList.list).toEqual([
      expect.objectContaining({ name: "Outline B" }),
    ]);
  });

  it("applies a remote overlay reorder while retaining a selected local draft", async () => {
    const overlayA = {
      id: "overlay-a",
      type: "participant",
      name: "Base A",
      duration: 7,
    };
    const overlayB = {
      id: "overlay-b",
      type: "participant",
      name: "Base B",
      duration: 7,
    };
    const remoteA = { ...overlayA, name: "Remote A" };
    const remoteB = { ...overlayB, name: "Remote B" };
    const db = {
      get: jest.fn().mockResolvedValue({
        _id: "outline",
        items: [{ _id: "Initial", name: "Initial", type: "song" }],
        overlays: ["overlay-a", "overlay-b"],
      }),
      put: jest.fn().mockResolvedValue({ ok: true, rev: "1-saved" }),
    } as any;
    const updater = new EventTarget();
    jest.mocked(getOverlaysByIds)
      .mockReset()
      .mockResolvedValueOnce([overlayA, overlayB] as any)
      .mockResolvedValueOnce([remoteB, remoteA] as any);
    store.dispatch(
      itemListsSlice.actions.initiateItemLists([
        { _id: "outline", name: "Sunday" },
      ]),
    );

    renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {}, updater } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });

    await waitFor(() => {
      expect(store.getState().undoable.present.overlays.list).toHaveLength(2);
    });
    act(() => {
      store.dispatch(overlaySlice.actions.selectOverlay(overlayA as any));
      store.dispatch(overlaySlice.actions.markOverlayDraftPending("overlay-a"));
    });

    await act(async () => {
      updater.dispatchEvent(
        new CustomEvent("update", {
          detail: [
            {
              _id: "outline",
              _rev: "2-reordered",
              items: [{ _id: "Initial", name: "Initial", type: "song" }],
              overlays: ["overlay-b", "overlay-a"],
            },
          ],
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(store.getState().undoable.present.overlays.list.map((o: { id: string }) => o.id)).toEqual([
        "overlay-b",
        "overlay-a",
      ]);
    });
    expect(store.getState().undoable.present.overlays.list).toEqual([
      expect.objectContaining({ id: "overlay-b", name: "Remote B" }),
      expect.objectContaining({ id: "overlay-a", name: "Base A" }),
    ]);
    expect(store.getState().undoable.present.overlay.pendingRemoteOverlay).toEqual(
      expect.objectContaining({ id: "overlay-a", name: "Remote A" }),
    );
  });

  it("ignores a remote overlay read that settles after switching outlines", async () => {
    const overlayA = {
      id: "overlay-a",
      type: "participant",
      name: "Outline A overlay",
    };
    const overlayB = {
      id: "overlay-b",
      type: "participant",
      name: "Outline A remote overlay",
    };
    const overlayC = {
      id: "overlay-c",
      type: "participant",
      name: "Outline B overlay",
    };
    const pendingRead = deferred<any[]>();
    const db = createDb({});
    const updater = new EventTarget();
    jest.mocked(getOverlaysByIds)
      .mockReset()
      .mockReturnValueOnce(pendingRead.promise);

    store.dispatch(
      itemListsSlice.actions.initiateItemLists([
        { _id: "outline-a", name: "Sunday" },
        { _id: "outline-b", name: "Wednesday" },
      ]),
    );
    store.dispatch(overlaysSlice.actions.initiateOverlayList([overlayA] as any));

    const { rerender } = renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, updater } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });

    act(() => {
      updater.dispatchEvent(
        new CustomEvent("update", {
          detail: [{
            _id: "outline-a",
            items: [],
            overlays: ["overlay-b"],
          }],
        }),
      );
    });
    await waitFor(() =>
      expect(getOverlaysByIds).toHaveBeenCalledWith(db, ["overlay-b"]),
    );

    store.dispatch(itemListsSlice.actions.selectItemList("outline-b"));
    store.dispatch(overlaysSlice.actions.initiateOverlayList([overlayC] as any));
    rerender();

    await act(async () => {
      pendingRead.resolve([overlayB]);
      await pendingRead.promise;
    });

    expect(store.getState().undoable.present.itemLists.selectedList?._id).toBe(
      "outline-b",
    );
    expect(store.getState().undoable.present.overlays.list).toEqual([
      expect.objectContaining({ id: "overlay-c", name: "Outline B overlay" }),
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
