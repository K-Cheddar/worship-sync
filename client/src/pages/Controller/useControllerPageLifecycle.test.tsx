import React from "react";
import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { Link, MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import store, { type RootState } from "../../store/store";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { itemListsSlice } from "../../store/itemListsSlice";
import {
  acknowledgeOutlineSave,
  initiateItemList,
  markItemListPersisted,
  moveItemListRows,
  retryItemListLoad,
  setItemListIsLoading,
} from "../../store/itemListSlice";
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
import { getOutlineDatabaseKey, setOutlineContentDatabase } from "../../store/outlineContent";
import { setActiveContentDatabase } from "../../store/deferredItemMutations";
import Overlays from "../../containers/Overlays/Overlays";
import type { ItemContentOwner, OverlayInfo } from "../../types";
import { createOutlineMoveIntent } from "../../utils/outlineSync";
import { persistServiceListItems } from "../../utils/persistServiceListField";
import { beginContentDatabaseSession } from "../../utils/contentReplicationActivity";

jest.mock("../../containers/Overlays/OverlayEditor", () => () => null);
jest.mock("../../containers/Overlays/ExistingOverlaysDrawer", () => () => null);
jest.mock("../../containers/Overlays/OverlayHistoryDrawer", () => () => null);
jest.mock("../../containers/Overlays/OverlayTemplatesDrawer", () => () => null);
jest.mock("../../components/StyleEditor", () => () => null);

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
    jest.mocked(readMediaLibrary).mockReset().mockResolvedValue({ list: [], folders: [] });
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
    await waitFor(() => expect(db.get).toHaveBeenCalledWith("outline", { conflicts: true }));
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

    db.get.mockResolvedValue({ _id: "outline", items: [{ _id: "song-2", name: "After", type: "song" }], overlays: ["overlay-1"] });
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
    const cloud = {} as never;
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
          <ControllerInfoContext.Provider value={{ db, cloud } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });

    await waitFor(() => expect(db.get).toHaveBeenCalledWith("outline", { conflicts: true }));
    await waitFor(() =>
      expect(store.getState().undoable.present.itemList.isLoading).toBe(false),
    );
    rerender();
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

    expect(db.get).not.toHaveBeenCalledWith("outline", { conflicts: true });
    expect(dispatchSpy).not.toHaveBeenCalledWith(setItemListIsLoading(true));
    expect(store.getState().undoable.present.itemList.list).toEqual([
      expect.objectContaining({ name: "Loaded outline" }),
    ]);
    dispatchSpy.mockRestore();
  });

  it("does not initialize an empty outline after repeated invalidated reads", async () => {
    const reads = Array.from({ length: 5 }, () => deferred<ReturnType<typeof details>>());
    const readState = { index: 0, isNotificationRead: false };
    const db = {
      get: jest.fn((id: string) => id === "outline"
        ? readState.isNotificationRead ? Promise.resolve({ _id: "outline", items: [], overlays: [] }) : reads[readState.index++].promise
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
      await waitFor(() => expect(readState.index).toBe(attempt + 1));
      await act(async () => {
        readState.isNotificationRead = true;
        updater.dispatchEvent(new CustomEvent("update", {
          detail: [{ _id: "outline", items: [], overlays: [] }],
        }));
        readState.isNotificationRead = false;
        reads[attempt].resolve(details(`stale-${attempt}`));
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    await waitFor(() => expect(store.getState().undoable.present.itemList.isLoading).toBe(false));
    expect(readState.index).toBe(5);
    expect(store.getState().undoable.present.itemList.isInitialized).toBe(false);
    expect(store.getState().undoable.present.itemList.list).toEqual([]);
    expect(store.getState().undoable.present.itemList.loadError).toMatch(/kept changing while it loaded/);
  });

  it("retries the local outline read when the content database session changes", async () => {
    const oldRead = deferred<ReturnType<typeof details>>();
    const databaseName = `outline-session-refresh-${Date.now()}-${Math.random()}`;
    let outlineReads = 0;
    const db = {
      name: databaseName,
      get: jest.fn((id: string) => id === "outline"
        ? ++outlineReads === 1 ? oldRead.promise : Promise.resolve({ _id: "outline", ...details("New session") })
        : Promise.resolve(undefined)),
      put: jest.fn().mockResolvedValue({ ok: true, rev: "1-saved" }),
    } as any;
    const firstSession = beginContentDatabaseSession(databaseName);
    let nextSession: ReturnType<typeof beginContentDatabaseSession> | undefined;
    let unmount: (() => void) | undefined;
    try {
      store.dispatch(itemListsSlice.actions.initiateItemLists([
        { _id: "outline", name: "Sunday" },
      ]));
      const view = renderHook(() => useControllerPageLifecycle(), {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <ControllerInfoContext.Provider value={{ db, cloud: {} } as any}>
              {children}
            </ControllerInfoContext.Provider>
          </Provider>
        ),
      });
      unmount = view.unmount;
      await waitFor(() => expect(outlineReads).toBe(1));

      act(() => { nextSession = beginContentDatabaseSession(databaseName); });
      await waitFor(() => expect(store.getState().undoable.present.itemList.list)
        .toEqual([expect.objectContaining({ name: "New session" })]));
      expect(outlineReads).toBe(2);
      expect(store.getState().undoable.present.itemList.isLoading).toBe(false);

      await act(async () => { oldRead.resolve(details("Stale session")); });
      expect(store.getState().undoable.present.itemList.list)
        .toEqual([expect.objectContaining({ name: "New session" })]);
    } finally {
      unmount?.();
      nextSession?.release();
      firstSession.release();
    }
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

  it.each([
    { compatible: false, onUpdate: false, viewOnly: false }, { compatible: true, onUpdate: false, viewOnly: false },
    { compatible: false, onUpdate: true, viewOnly: false }, { compatible: true, onUpdate: true, viewOnly: false },
    { compatible: true, onUpdate: false, viewOnly: true }, { compatible: true, onUpdate: true, viewOnly: true },
  ])("displays the winner without reviewing or reconciling offline saved revisions (compatible: $compatible, on update: $onUpdate, view-only: $viewOnly)", async ({ compatible, onUpdate, viewOnly }) => {
    const id = `lifecycle-branches-${Date.now()}-${Math.random()}`;
    const a = new PouchDB(`${id}-a`);
    const b = new PouchDB(`${id}-b`);
    const rows = [{ _id: "a", listId: "row-a", name: "A", type: "song" }, { _id: "b", listId: "row-b", name: "B", type: "song" }];
    let unmount: (() => void) | undefined;
    try {
      await a.put({ _id: "outline", items: rows, overlays: [] });
      await b.replicate.from(a);
      const base = await a.get<{ items: typeof rows }>("outline");
      await a.put({ ...base, items: [{ ...rows[0], name: "A from device A" }, rows[1]] });
      await b.put({ ...base, items: compatible ? [rows[0], { ...rows[1], name: "B from device B" }] : [{ ...rows[0], name: "A from device B" }, rows[1]] });
      if (!onUpdate) await b.replicate.from(a);
      const reads = jest.spyOn(b, "get");
      const writes = jest.spyOn(b, "put");
      const updater = new EventTarget();
      store.dispatch(itemListsSlice.actions.initiateItemLists([{ _id: "outline", name: "Sunday" }]));
      const view = renderHook(() => useControllerPageLifecycle(), { wrapper: ({ children }) => (
        <Provider store={store}><GlobalInfoContext.Provider value={{ access: viewOnly ? "view" : "full" } as any}><ControllerInfoContext.Provider value={{ db: b, cloud: {}, updater } as any}>{children}</ControllerInfoContext.Provider></GlobalInfoContext.Provider></Provider>
      ) });
      unmount = view.unmount;
      await waitFor(() => expect(store.getState().undoable.present.itemList.isLoading).toBe(false));
      if (onUpdate) await b.replicate.from(a);
      // For the update case, replication introduced the graph only after the
      // initial conflict-free outline was already open on the controller.
      const head = await b.get<{ items: typeof rows }>("outline", { conflicts: true });
      const eventRevision = head._conflicts?.[0] ?? head._rev;
      if (onUpdate) {
        await act(async () => {
          updater.dispatchEvent(new CustomEvent("update", { detail: [{ _id: "outline", _rev: eventRevision }] }));
        });
      }
      await waitFor(() => expect(store.getState().undoable.present.itemList.list).toEqual(head.items));
      expect(store.getState().undoable.present.itemList.remoteConflicts).toEqual({});
      expect(store.getState().undoable.present.itemList.hasPendingUpdate).toBe(false);
      const state: RootState["undoable"]["present"]["itemList"] = store.getState().undoable.present.itemList;
      const inspections = reads.mock.calls.filter(([, options]) => options && "revs" in options).length;
      await act(async () => {
        updater.dispatchEvent(new CustomEvent("update", { detail: [{ _id: "outline", _rev: eventRevision }] }));
      });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      const afterFirstEvent = reads.mock.calls.length;
      await act(async () => {
        updater.dispatchEvent(new CustomEvent("update", { detail: [{ _id: "outline", _rev: eventRevision }] }));
      });
      expect(reads).toHaveBeenCalledTimes(afterFirstEvent);
      const saved = await b.get("outline", { conflicts: true });
      const outcome = {
        hasConflict: Boolean(state.remoteConflicts.outline?.revisionConflict),
        savedBranches: saved._conflicts?.length ?? 0,
        names: state.list.map((item) => item.name),
      };
      expect(outcome).toEqual({ hasConflict: false, savedBranches: 1, names: head.items.map((item: { name: string }) => item.name) });
      expect(writes.mock.calls.filter(([document]) => document._id === "outline")).toHaveLength(0);
      // Repeated unresolved graphs use cached branch review, with only metadata
      // checked for the first new replication event.
      const branchReadsAfter = reads.mock.calls.filter(([, options]) => options && "revs" in options).length;
      expect(branchReadsAfter).toBe(inspections);
    } finally {
      unmount?.();
      await Promise.all([a.destroy(), b.destroy()]);
    }
  });

  it("merges acknowledged independent Controller moves from the replication refresh and stays editable", async () => {
    const suffix = `lifecycle-move-convergence-${Date.now()}-${Math.random()}`;
    const shared = new PouchDB(`${suffix}-shared`);
    const clientA = new PouchDB(`${suffix}-a`);
    const clientB = new PouchDB(`${suffix}-b`);
    const updater = new EventTarget();
    const baseline = ["a", "b", "c", "d", "e"].map(id => ({
      _id: `song-${id}`, listId: id, name: id.toUpperCase(), type: "song",
    }));
    const outlineId = "outline";
    let unmount: (() => void) | undefined;
    try {
      await shared.put({ _id: outlineId, docType: "itemListDetails", name: "Sunday", items: baseline, overlays: [] });
      await Promise.all([clientA.replicate.from(shared), clientB.replicate.from(shared)]);
      const intentA = createOutlineMoveIntent({
        outlineId, ownerKey: "controller-a", movedIds: ["b"],
        resultingItems: [baseline[1], baseline[0], baseline[2], baseline[3], baseline[4]],
      })!;
      const intentB = createOutlineMoveIntent({
        outlineId, ownerKey: "controller-b", movedIds: ["e"],
        resultingItems: [baseline[0], baseline[1], baseline[2], baseline[4], baseline[3]],
      })!;
      const moveA = [baseline[1], baseline[0], baseline[2], baseline[3], baseline[4]];
      const moveB = [baseline[0], baseline[1], baseline[2], baseline[4], baseline[3]];
      const persistedA = await persistServiceListItems(clientA as never, outlineId, moveA, baseline, undefined, [intentA]);

      store.dispatch(itemListsSlice.actions.initiateItemLists([{ _id: outlineId, name: "Sunday" }]));
      const view = renderHook(() => useControllerPageLifecycle(), { wrapper: ({ children }) => (
        <Provider store={store}>
          <GlobalInfoContext.Provider value={{ access: "full" } as any}>
            <ControllerInfoContext.Provider value={{ db: clientB, cloud: {}, updater } as any}>
              {children}
            </ControllerInfoContext.Provider>
          </GlobalInfoContext.Provider>
        </Provider>
      ) });
      unmount = view.unmount;
      await waitFor(() => expect(store.getState().undoable.present.itemList.isLoading).toBe(false));

      const ownerKey = store.getState().undoable.present.itemList.outlineOwnerKey!;
      const intentBForController = { ...intentB, ownerKey };
      act(() => store.dispatch(moveItemListRows({ items: moveB, intent: intentBForController })));
      const submittedB = store.getState().undoable.present.itemList.list;
      const persistedB = await persistServiceListItems(
        clientB as never, outlineId, submittedB, baseline, undefined, [intentBForController],
      );
      act(() => {
        store.dispatch(acknowledgeOutlineSave({ ownerKey, list: submittedB }));
        store.dispatch(markItemListPersisted({
          outlineId, ownerKey, items: persistedB.items, submittedItems: submittedB,
          submittedMoveIntents: [intentBForController],
        }));
      });
      const acknowledged = store.getState().undoable.present.itemList;
      expect(acknowledged.hasPendingUpdate).toBe(false);
      expect(acknowledged.pendingMoveIntents).toEqual([]);
      expect((await clientA.get<{ outlineMoveIntent?: { baseRevision: string } }>(outlineId)).outlineMoveIntent?.baseRevision)
        .toBe((await shared.get<{ _rev: string }>(outlineId))._rev);

      await clientA.replicate.to(shared);
      await clientB.replicate.to(shared);
      await clientB.replicate.from(shared);
      const competing = await clientB.get<{ _rev: string; _conflicts?: string[] }>(outlineId, { conflicts: true });
      expect(competing._conflicts).toHaveLength(1);
      const writes = jest.spyOn(clientB, "put");
      await act(async () => {
        updater.dispatchEvent(new CustomEvent("update", { detail: [{ _id: outlineId, _rev: competing._conflicts![0] }] }));
      });

      await waitFor(() => expect(store.getState().undoable.present.itemList.list.map((item: { listId: string }) => item.listId))
        .toEqual(["b", "a", "c", "e", "d"]));
      const converged = store.getState().undoable.present.itemList;
      expect(converged.syncBaseline?.map((item: { listId: string }) => item.listId)).toEqual(["b", "a", "c", "e", "d"]);
      expect(converged.hasPendingUpdate).toBe(false);
      expect(converged.remoteConflicts).toEqual({});
      expect(writes).toHaveBeenCalledTimes(1);
      expect((await clientB.get<{ _conflicts?: string[] }>(outlineId, { conflicts: true }))._conflicts).toBeUndefined();

      // A second event for the merge revision and a duplicate event for the
      // original branch cannot repeat the write.
      const mergedHead = await clientB.get<{ _rev: string }>(outlineId);
      await act(async () => {
        updater.dispatchEvent(new CustomEvent("update", { detail: [{ _id: outlineId, _rev: mergedHead._rev }] }));
        updater.dispatchEvent(new CustomEvent("update", { detail: [{ _id: outlineId, _rev: competing._conflicts![0] }] }));
      });
      expect(writes).toHaveBeenCalledTimes(1);

      const continuedItems = [converged.list[2], ...converged.list.slice(0, 2), ...converged.list.slice(3)];
      const continuedIntent = createOutlineMoveIntent({
        outlineId, ownerKey, movedIds: ["c"], resultingItems: continuedItems,
      })!;
      act(() => store.dispatch(moveItemListRows({ items: continuedItems, intent: continuedIntent })));
      const continuedDraft = store.getState().undoable.present.itemList.list;
      const continuedSave = await persistServiceListItems(
        clientB as never, outlineId, continuedDraft, converged.syncBaseline, undefined, [continuedIntent],
      );
      act(() => {
        store.dispatch(acknowledgeOutlineSave({ ownerKey, list: continuedDraft }));
        store.dispatch(markItemListPersisted({
          outlineId, ownerKey, items: continuedSave.items, submittedItems: continuedDraft,
          submittedMoveIntents: [continuedIntent],
        }));
      });
      expect((await clientB.get<{ items: typeof baseline }>(outlineId)).items.map(item => item.listId))
        .toEqual(["c", "b", "a", "e", "d"]);
      expect(persistedA.items.map(item => item.listId)).toEqual(["b", "a", "c", "d", "e"]);

      await clientB.replicate.to(shared);
      await clientA.replicate.from(shared);
      unmount?.();
      unmount = undefined;
      store.dispatch({ type: "RESET_CONTROLLER_SESSION" });
      store.dispatch(itemListsSlice.actions.initiateItemLists([{ _id: outlineId, name: "Sunday" }]));
      const updaterA = new EventTarget();
      const { unmount: unmountControllerA } = renderHook(() => useControllerPageLifecycle(), { wrapper: ({ children }) => (
        <Provider store={store}>
          <GlobalInfoContext.Provider value={{ access: "full" } as any}>
            <ControllerInfoContext.Provider value={{ db: clientA, cloud: {}, updater: updaterA } as any}>
              {children}
            </ControllerInfoContext.Provider>
          </GlobalInfoContext.Provider>
        </Provider>
      ) });
      unmount = unmountControllerA;
      await waitFor(() => expect(store.getState().undoable.present.itemList.list.map((item: { listId: string }) => item.listId))
        .toEqual(["c", "b", "a", "e", "d"]));
      const receivedByA = await clientA.get<{ _rev: string }>(outlineId);
      await act(async () => {
        updaterA.dispatchEvent(new CustomEvent("update", { detail: [{ _id: outlineId, _rev: receivedByA._rev }] }));
      });
      expect(store.getState().undoable.present.itemList.remoteConflicts).toEqual({});
      expect(store.getState().undoable.present.itemList.hasPendingUpdate).toBe(false);
    } finally {
      unmount?.();
      await Promise.all([shared.destroy(), clientA.destroy(), clientB.destroy()]);
    }
  });

  it("reconciles after the original Controllers close and lets a read-only Controller load the result", async () => {
    const suffix = `third-controller-outline-${Date.now()}-${Math.random()}`;
    const shared = new PouchDB(`${suffix}-shared`);
    const clientA = new PouchDB(`${suffix}-a`);
    const clientB = new PouchDB(`${suffix}-b`);
    const thirdController = new PouchDB(`${suffix}-third`);
    const readOnlyController = new PouchDB(`${suffix}-view`);
    const baseline = ["a", "b", "c", "d", "e"].map(id => ({
      _id: `song-${id}`, listId: id, name: id.toUpperCase(), type: "song",
    }));
    const outlineId = "outline";
    let unmount: (() => void) | undefined;
    let originalsClosed = false;
    try {
      await shared.put({ _id: outlineId, docType: "itemListDetails", name: "Sunday", items: baseline, overlays: [] });
      await Promise.all([clientA.replicate.from(shared), clientB.replicate.from(shared)]);
      const moveA = [baseline[1], baseline[0], baseline[2], baseline[3], baseline[4]];
      const moveB = [baseline[0], baseline[1], baseline[2], baseline[4], baseline[3]];
      const intentA = createOutlineMoveIntent({
        outlineId, ownerKey: "closed-controller-a", movedIds: ["b"], resultingItems: moveA,
      })!;
      const intentB = createOutlineMoveIntent({
        outlineId, ownerKey: "closed-controller-b", movedIds: ["e"], resultingItems: moveB,
      })!;
      await Promise.all([
        persistServiceListItems(clientA as never, outlineId, moveA, baseline, undefined, [intentA]),
        persistServiceListItems(clientB as never, outlineId, moveB, baseline, undefined, [intentB]),
      ]);
      await clientA.replicate.to(shared);
      await clientB.replicate.to(shared);
      expect((await shared.get<{ _conflicts?: string[] }>(outlineId, { conflicts: true }))._conflicts)
        .toHaveLength(1);
      await Promise.all([clientA.destroy(), clientB.destroy()]);
      originalsClosed = true;

      await readOnlyController.replicate.from(shared);
      const readOnlyWrites = jest.spyOn(readOnlyController, "put");
      const initialReadOnlyUpdater = new EventTarget();
      store.dispatch(itemListsSlice.actions.initiateItemLists([{ _id: outlineId, name: "Sunday" }]));
      const { unmount: unmountInitialReadOnly } = renderHook(() => useControllerPageLifecycle(), { wrapper: ({ children }) => (
        <Provider store={store}>
          <GlobalInfoContext.Provider value={{ access: "view" } as any}>
            <ControllerInfoContext.Provider value={{ db: readOnlyController, cloud: {}, updater: initialReadOnlyUpdater } as any}>
              {children}
            </ControllerInfoContext.Provider>
          </GlobalInfoContext.Provider>
        </Provider>
      ) });
      unmount = unmountInitialReadOnly;
      await waitFor(() => expect([
        JSON.stringify(moveA.map(item => item.listId)),
        JSON.stringify(moveB.map(item => item.listId)),
      ]).toContain(JSON.stringify(store.getState().undoable.present.itemList.list.map((item: { listId: string }) => item.listId))));
      expect(readOnlyWrites.mock.calls.some(([document]) => document._id === outlineId)).toBe(false);
      expect((await readOnlyController.get<{ _conflicts?: string[] }>(outlineId, { conflicts: true }))._conflicts)
        .toHaveLength(1);
      unmount();
      unmount = undefined;
      store.dispatch({ type: "RESET_CONTROLLER_SESSION" });

      await thirdController.replicate.from(shared);
      const authorizedUpdater = new EventTarget();
      store.dispatch(itemListsSlice.actions.initiateItemLists([{ _id: outlineId, name: "Sunday" }]));
      const { unmount: unmountThirdController } = renderHook(() => useControllerPageLifecycle(), { wrapper: ({ children }) => (
        <Provider store={store}>
          <GlobalInfoContext.Provider value={{ access: "full" } as any}>
            <ControllerInfoContext.Provider value={{ db: thirdController, cloud: {}, updater: authorizedUpdater } as any}>
              {children}
            </ControllerInfoContext.Provider>
          </GlobalInfoContext.Provider>
        </Provider>
      ) });
      unmount = unmountThirdController;
      await waitFor(() => expect(store.getState().undoable.present.itemList.list.map((item: { listId: string }) => item.listId))
        .toEqual(["b", "a", "c", "e", "d"]));
      expect(store.getState().undoable.present.itemList.remoteConflicts).toEqual({});
      expect(store.getState().undoable.present.itemList.hasPendingUpdate).toBe(false);
      expect((await thirdController.get<{ _conflicts?: string[] }>(outlineId, { conflicts: true }))._conflicts)
        .toBeUndefined();

      await thirdController.replicate.to(shared);
      unmount();
      unmount = undefined;
      store.dispatch({ type: "RESET_CONTROLLER_SESSION" });

      await readOnlyController.replicate.from(shared);
      const readOnlyUpdater = new EventTarget();
      store.dispatch(itemListsSlice.actions.initiateItemLists([{ _id: outlineId, name: "Sunday" }]));
      const { unmount: unmountReadOnly } = renderHook(() => useControllerPageLifecycle(), { wrapper: ({ children }) => (
        <Provider store={store}>
          <GlobalInfoContext.Provider value={{ access: "view" } as any}>
            <ControllerInfoContext.Provider value={{ db: readOnlyController, cloud: {}, updater: readOnlyUpdater } as any}>
              {children}
            </ControllerInfoContext.Provider>
          </GlobalInfoContext.Provider>
        </Provider>
      ) });
      unmount = unmountReadOnly;
      await waitFor(() => expect(store.getState().undoable.present.itemList.list.map((item: { listId: string }) => item.listId))
        .toEqual(["b", "a", "c", "e", "d"]));
      expect(readOnlyWrites.mock.calls.some(([document]) => document._id === outlineId)).toBe(false);
      expect(store.getState().undoable.present.itemList.remoteConflicts).toEqual({});
      expect((await readOnlyController.get<{ _conflicts?: string[] }>(outlineId, { conflicts: true }))._conflicts)
        .toBeUndefined();
    } finally {
      unmount?.();
      if (!originalsClosed) await Promise.all([clientA.destroy(), clientB.destroy()]);
      await Promise.all([shared.destroy(), thirdController.destroy(), readOnlyController.destroy()]);
    }
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
    await waitFor(() => expect(db.get).toHaveBeenCalledWith("outline-a", { conflicts: true }));

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

  it("retries a replication notification after its outline read is invalidated by a session change", async () => {
    const staleEventRead = deferred<ReturnType<typeof details>>();
    const databaseName = `outline-event-session-${Date.now()}-${Math.random()}`;
    let outlineReads = 0;
    const db = {
      name: databaseName,
      get: jest.fn((id: string) => {
        if (id !== "outline") return Promise.resolve(undefined);
        outlineReads += 1;
        return outlineReads === 2
          ? staleEventRead.promise
          : Promise.resolve({ _id: "outline", ...details(`Outline ${outlineReads}`) });
      }),
      put: jest.fn().mockResolvedValue({ ok: true, rev: "1-saved" }),
    } as any;
    const firstSession = beginContentDatabaseSession(databaseName);
    const updater = new EventTarget();
    let nextSession: ReturnType<typeof beginContentDatabaseSession> | undefined;
    let unmount: (() => void) | undefined;
    try {
      store.dispatch(itemListsSlice.actions.initiateItemLists([
        { _id: "outline", name: "Sunday" },
      ]));
      const view = renderHook(() => useControllerPageLifecycle(), {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <ControllerInfoContext.Provider value={{ db, cloud: {}, updater } as any}>
              {children}
            </ControllerInfoContext.Provider>
          </Provider>
        ),
      });
      unmount = view.unmount;
      await waitFor(() => expect(store.getState().undoable.present.itemList.list)
        .toEqual([expect.objectContaining({ name: "Outline 1" })]));

      const notification = new CustomEvent("update", {
        detail: [{ _id: "outline", _rev: "2-replicated" }],
      });
      act(() => updater.dispatchEvent(notification));
      await waitFor(() => expect(outlineReads).toBe(2));

      act(() => { nextSession = beginContentDatabaseSession(databaseName); });
      await waitFor(() => expect(store.getState().undoable.present.itemList.list)
        .toEqual([expect.objectContaining({ name: "Outline 3" })]));
      await act(async () => { staleEventRead.resolve(Object.assign(details("Stale event"), { _id: "outline" })); });

      act(() => updater.dispatchEvent(notification));
      await waitFor(() => expect(outlineReads).toBe(4));
      await waitFor(() => expect(store.getState().undoable.present.itemList.list)
        .toEqual([expect.objectContaining({ name: "Outline 4" })]));
    } finally {
      unmount?.();
      nextSession?.release();
      firstSession.release();
    }
  });

  it("captures the active content owner and session for replicated Song V2 changes", async () => {
    const db = new PouchDB(`song-v2-refresh-session-${Date.now()}-${Math.random()}`);
    const owner: ItemContentOwner = {
      scopeId: `user-a:church-a:${db.name}`,
      databaseKey: getOutlineDatabaseKey(db),
      churchId: "church-a",
      accountId: "user-a",
    };
    const session = beginContentDatabaseSession(db.name);
    const updater = new EventTarget();
    const dispatch = jest.spyOn(store, "dispatch");
    let unmount: (() => void) | undefined;
    try {
      setActiveContentDatabase(owner, db as never);
      const view = renderHook(() => useControllerPageLifecycle(), {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <ControllerInfoContext.Provider value={{ db, cloud: {}, updater } as any}>
              {children}
            </ControllerInfoContext.Provider>
          </Provider>
        ),
      });
      unmount = view.unmount;

      act(() => updater.dispatchEvent(new CustomEvent("update", {
        detail: [{ _id: "song-v2:arrangement:song-a:master" }],
      })));
      await waitFor(() => expect(dispatch.mock.calls.some(([action]) =>
        (action as { type?: string }).type === "songV2/documentsChanged",
      )).toBe(true));
      const refresh = dispatch.mock.calls.map(([action]) => action as {
        type?: string;
        payload?: Array<Record<string, unknown>>;
      }).find(action => action.type === "songV2/documentsChanged");
      expect(refresh?.payload).toEqual([{
        songId: "song-a",
        libraryChanged: true,
        database: db,
        owner,
        sessionToken: session.token,
      }]);
    } finally {
      unmount?.();
      session.release();
      setActiveContentDatabase(null);
      dispatch.mockRestore();
      await db.destroy();
    }
  });

  it("retries the same selected outline without initializing libraries or overlays again", async () => {
    let fails = true;
    const db = {
      get: jest.fn(async (id: string) => {
        if (id !== "outline") return undefined;
        if (fails) throw new Error("offline");
        return { _id: "outline", ...details("Recovered") };
      }),
      put: jest.fn(),
    } as any;
    store.dispatch(itemListsSlice.actions.initiateItemLists([{ _id: "outline", name: "Sunday" }]));
    const view = renderHook(() => useControllerPageLifecycle(), { wrapper: ({ children }) => (
      <Provider store={store}><ControllerInfoContext.Provider value={{ db, cloud: {} } as any}>{children}</ControllerInfoContext.Provider></Provider>
    ) });
    await waitFor(() => expect(store.getState().undoable.present.itemList.loadError).toMatch(/Could not load/));
    expect(store.getState().undoable.present.itemList.isInitialized).toBe(false);
    const libraries = jest.mocked(readMediaLibrary).mock.calls.length;
    const otherReads = db.get.mock.calls.filter(([id]: [string]) => id !== "outline").length;
    fails = false;
    act(() => store.dispatch(retryItemListLoad()));
    view.rerender();
    await waitFor(() => expect(store.getState().undoable.present.itemList.list[0]?.name).toBe("Recovered"));
    expect(store.getState().undoable.present.itemList.loadError).toBeNull();
    expect(store.getState().undoable.present.itemList.isRetrying).toBe(false);
    expect(jest.mocked(readMediaLibrary).mock.calls.length).toBe(libraries);
    expect(db.get.mock.calls.filter(([id]: [string]) => id !== "outline")).toHaveLength(otherReads);
    expect(store.getState().undoable.present.itemLists.selectedList?._id).toBe("outline");
  });

  it("preserves usable rows after a failed background retry and ignores retry results after selection changes", async () => {
    const retry = deferred<ReturnType<typeof details>>();
    const cloud = {} as never;
    const db = {
      get: jest.fn(async (id: string) => id === "outline" ? Promise.reject(new Error("offline")) : { _id: id, ...details("New outline") }),
      put: jest.fn(),
    } as any;
    store.dispatch(itemListsSlice.actions.initiateItemLists([{ _id: "outline", name: "Sunday" }, { _id: "b", name: "B" }]));
    store.dispatch(setOutlineContentDatabase(getOutlineDatabaseKey(db)));
    store.dispatch(initiateItemList({ outlineId: "outline", items: [{ _id: "usable", name: "Usable draft", type: "song", listId: "row" }] }));
    store.dispatch(setItemListIsLoading(false));
    const view = renderHook(() => useControllerPageLifecycle(), { wrapper: ({ children }) => (
      <Provider store={store}><ControllerInfoContext.Provider value={{ db, cloud } as any}>{children}</ControllerInfoContext.Provider></Provider>
    ) });
    await waitFor(() => expect(store.getState().undoable.present.itemList.loadError).toMatch(/Could not load/));
    expect(store.getState().undoable.present.itemList.list[0].name).toBe("Usable draft");
    db.get.mockImplementation((id: string) => id === "outline" ? retry.promise : Promise.resolve({ _id: id, ...details("New outline") }));
    act(() => store.dispatch(retryItemListLoad()));
    view.rerender();
    expect(store.getState().undoable.present.itemList.isLoading).toBe(false);
    expect(store.getState().undoable.present.itemList.list[0].name).toBe("Usable draft");
    act(() => store.dispatch(itemListsSlice.actions.selectItemList("b")));
    view.rerender();
    await waitFor(() => expect(store.getState().undoable.present.itemList.loadedOutlineId).toBe("b"));
    await act(async () => { retry.resolve(details("Obsolete")); });
    expect(store.getState().undoable.present.itemList.list[0].name).toBe("New outline");
    expect(store.getState().undoable.present.itemList.loadError).toBeNull();
  });

  it("routes replicated slide-only v2 changes to targeted content refresh", async () => {
    setActiveContentDatabase(null);
    const db = createDb({});
    const updater = new EventTarget();
    const dispatch = jest.spyOn(store, "dispatch");
    renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ db, cloud: {}, updater } as any}>
            {children}
          </ControllerInfoContext.Provider>
        </Provider>
      ),
    });

    await act(async () => {
      updater.dispatchEvent(new CustomEvent("update", {
        detail: [{ _id: "song-v2:slide:song-42:main:verse-2" }],
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "songV2/documentsChanged",
      payload: [expect.objectContaining({ songId: "song-42", libraryChanged: false, database: db })],
    }));
    dispatch.mockRestore();
  });

  it("refreshes overlay content on /controller before navigating to the Overlays page", async () => {
    const user = userEvent.setup();
    const overlay: OverlayInfo = { id: "participant", type: "participant", name: "Before", title: "Host" };
    const db = createDb({});
    const updater = new EventTarget();
    const Session = () => {
      useControllerPageLifecycle();
      return <><Link to="/controller/overlays">Open overlays</Link><Outlet /></>;
    };
    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={{ db, cloud: {}, updater } as any}>
          <GlobalInfoContext.Provider value={{ access: "full" } as any}>
            <MemoryRouter initialEntries={["/controller"]}>
              <Routes>
                <Route path="/controller" element={<Session />}>
                  <Route index element={<p>Song workspace</p>} />
                  <Route path="overlays" element={<Overlays />} />
                </Route>
              </Routes>
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );
    act(() => {
      store.dispatch(overlaysSlice.actions.initiateOverlayList([overlay]));
      updater.dispatchEvent(new CustomEvent("update", { detail: [{
        ...overlay, _id: "overlay-participant", name: "Remote name", title: "Remote title",
      }] }));
    });
    expect(screen.getByText("Song workspace")).toBeInTheDocument();
    expect(store.getState().undoable.present.overlays.list).toEqual([
      expect.objectContaining({ id: "participant", name: "Remote name", title: "Remote title" }),
    ]);
    await user.click(screen.getByRole("link", { name: "Open overlays" }));
    expect(screen.getByText("Remote name")).toBeInTheDocument();
    expect(screen.getByText("Remote title")).toBeInTheDocument();
    expect(screen.queryByText("Before")).not.toBeInTheDocument();
    expect(db.get).not.toHaveBeenCalledWith("overlay-participant");
    expect(getOverlaysByIds).not.toHaveBeenCalled();
  });

  it.each(["editor draft", "Redux edit"])("buffers remote content against a selected %s outside Overlays", (pendingKind) => {
    const overlay: OverlayInfo = { id: "participant", type: "participant", name: "Local", title: "Host" };
    const other: OverlayInfo = { id: "other", type: "participant", name: "Other" };
    const updater = new EventTarget();
    renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ updater } as any}>{children}</ControllerInfoContext.Provider>
        </Provider>
      ),
    });
    act(() => {
      store.dispatch(overlaysSlice.actions.initiateOverlayList([overlay, other]));
      store.dispatch(overlaySlice.actions.selectOverlay(overlay));
      store.dispatch(overlaysSlice.actions.setHasPendingUpdate(true));
      store.dispatch(pendingKind === "editor draft"
        ? overlaySlice.actions.markOverlayDraftPending(overlay.id)
        : overlaySlice.actions.updateOverlay({ ...overlay, name: "Unsaved" }));
      const docs = [
        { ...overlay, _id: "overlay-participant", name: "Remote" },
        { ...other, _id: "overlay-other", name: "Remote other" },
        { ...other, _id: "overlay-library-only", id: "library-only" },
      ];
      updater.dispatchEvent(new CustomEvent("update", { detail: docs }));
      updater.dispatchEvent(new CustomEvent("update", { detail: docs }));
    });
    const { overlays, overlay: selected } = store.getState().undoable.present;
    expect(overlays.list).toEqual([
      expect.objectContaining({ id: "participant", name: "Local" }),
      expect.objectContaining({ id: "other", name: "Remote other" }),
    ]);
    expect(overlays.hasPendingUpdate).toBe(true);
    expect(selected.selectedOverlay?.name).toBe(pendingKind === "editor draft" ? "Local" : "Unsaved");
    expect(selected.hasRemoteUpdate).toBe(true);
    expect(selected.pendingRemoteOverlay).toEqual(expect.objectContaining({ id: "participant", name: "Remote" }));
  });

  it("syncs a clean selection from a broadcast and removes the replication listener on unmount", () => {
    const overlay: OverlayInfo = { id: "participant", type: "participant", name: "Before" };
    const updater = new EventTarget();
    const { unmount } = renderHook(() => useControllerPageLifecycle(), {
      wrapper: ({ children }) => (
        <Provider store={store}>
          <ControllerInfoContext.Provider value={{ updater } as any}>{children}</ControllerInfoContext.Provider>
        </Provider>
      ),
    });
    const broadcastHandler = jest.mocked(useGlobalBroadcast).mock.calls[3][0];
    act(() => {
      store.dispatch(overlaysSlice.actions.initiateOverlayList([overlay]));
      store.dispatch(overlaySlice.actions.selectOverlay(overlay));
      broadcastHandler({ detail: [{ ...overlay, _id: "overlay-participant", name: "Broadcast name" }] });
    });
    expect(store.getState().undoable.present.overlay.selectedOverlay?.name).toBe("Broadcast name");
    expect(store.getState().undoable.present.overlays.list[0].name).toBe("Broadcast name");
    expect(store.getState().undoable.present.overlay.hasPendingUpdate).toBe(false);
    unmount();
    act(() => {
      store.dispatch(overlaysSlice.actions.initiateOverlayList([overlay]));
      updater.dispatchEvent(new CustomEvent("update", { detail: [{ ...overlay, _id: "overlay-participant", name: "Too late" }] }));
    });
    expect(store.getState().undoable.present.overlays.list[0].name).toBe("Before");
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

    db.get.mockResolvedValue({ _id: "outline", items: [{ _id: "Initial", name: "Initial", type: "song" }], overlays: ["overlay-b", "overlay-a"] });
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

    db.get.mockResolvedValue({ _id: "outline-a", items: [], overlays: ["overlay-b"] });
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

    await waitFor(() => expect(db.get).toHaveBeenCalledWith("outline", { conflicts: true }));
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
