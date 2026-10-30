import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { ActionCreators } from "redux-undo";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useSelector } from "../../hooks";
import store from "../../store/store";
import { itemListSlice } from "../../store/itemListSlice";
import { itemListsSlice } from "../../store/itemListsSlice";
import { overlaysSlice } from "../../store/overlaysSlice";
import { overlaySlice } from "../../store/overlaySlice";
import Overlays from "../../containers/Overlays/Overlays";
import { createServiceItem, createOverlay } from "../../test/fixtures";
import { createMockControllerContext } from "../../test/mocks";
import type { DBItemListDetails } from "../../types";
import { useControllerPageLifecycle } from "./useControllerPageLifecycle";

let mockDatabase: ReturnType<typeof database> | undefined;
const mockPublish = jest.fn();
jest.mock("../../context/controllerInfo", () => ({
  ControllerInfoContext: jest.requireActual("react").createContext(null),
  get globalDb() { return mockDatabase; },
  globalBroadcastRef: { postMessage: (...args: unknown[]) => mockPublish(...args) },
}));
jest.mock("../../context/globalInfo", () => ({
  GlobalInfoContext: jest.requireActual("react").createContext(null),
  globalFireDbInfo: { churchId: "church", database: "test" },
}));
jest.mock("../../hooks/useGlobalBroadcast", () => ({ useGlobalBroadcast: jest.fn() }));
jest.mock("../../hooks/useSyncOnReconnect", () => ({ useSyncOnReconnect: jest.fn() }));
jest.mock("../../context/toastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock("../../utils/controllerBootstrapDocs", () => ({
  loadOrCreatePreferencesBundle: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../utils/controllerMediaRouteFolders", () => ({
  loadOrCreateControllerMediaRouteFolders: jest.fn().mockResolvedValue({ mediaRouteFolders: {} }),
}));
jest.mock("../../utils/mediaDocUtils", () => ({
  ...jest.requireActual("../../utils/mediaDocUtils"),
  loadMediaLibrary: jest.fn().mockResolvedValue({ list: [], folders: [] }),
  requireMediaLibraryV2: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../utils/formatItemList", () => ({ formatItemList: (items: unknown[]) => items }));
jest.mock("firebase/database", () => ({ ref: jest.fn(), onValue: jest.fn() }));
jest.mock("../../containers/Overlays/OverlayEditor", () => {
  const { useOverlayDraft } = jest.requireActual<typeof import("../../hooks/useOverlayDraft")>("../../hooks/useOverlayDraft");
  return ({ selectedOverlay, readOnly, handleOverlayUpdate }: {
    selectedOverlay: import("../../types").OverlayInfo;
    readOnly: boolean;
    handleOverlayUpdate: (overlay: import("../../types").OverlayInfo) => void;
  }) => {
    const { draft, patchDraft } = useOverlayDraft(selectedOverlay, handleOverlayUpdate);
    return <input aria-label="Overlay editor" value={draft.name} disabled={!selectedOverlay.id || readOnly} onChange={(event) => patchDraft({ name: event.target.value })} />;
  };
});
jest.mock("../../containers/Overlays/ExistingOverlaysDrawer", () => () => null);
jest.mock("../../containers/Overlays/OverlayHistoryDrawer", () => () => null);
jest.mock("../../containers/Overlays/OverlayTemplatesDrawer", () => () => null);
jest.mock("../../components/StyleEditor", () => () => null);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const item = (name: string) => createServiceItem({ _id: name, name, listId: name });
const overlay = (id: string) => createOverlay({ id, name: id });
const details = (id: string): DBItemListDetails => ({
  _id: id, _rev: "1-base", name: id, items: [item(id)], overlays: [id],
  servicePlanBinding: { planKey: `plan-${id}`, planName: `Plan ${id}`, linkedAt: "2026-10-29T12:00:00.000Z" },
});
const database = () => {
  let registry = { _id: "ItemLists", _rev: "1-registry", itemLists: [{ _id: "a", name: "A" }, { _id: "b", name: "B" }], activeList: { _id: "a", name: "A" } };
  const docs = new Map<string, DBItemListDetails>([["a", details("a")], ["b", details("b")]]);
  const overlayDocs = new Map<string, DBItemListDetails>(["a", "b"].map((id) => [`overlay-${id}`, { ...details(id), ...overlay(id), _id: `overlay-${id}` }]));
  const heldReads = new Map<string, ReturnType<typeof deferred<DBItemListDetails>>>();
  const heldWrites = new Map<string, ReturnType<typeof deferred<void>>>();
  const db = {
    name: "same-database-name",
    get: jest.fn(async (id: string): Promise<unknown> => {
      const held = heldReads.get(id);
      if (held) { heldReads.delete(id); return held.promise; }
      if (id === "ItemLists") return { ...registry };
      const document = id.startsWith("overlay-") ? overlayDocs.get(id) : docs.get(id);
      return document ? { ...document } : undefined;
    }),
    put: jest.fn(async (next: DBItemListDetails) => {
      if (next._id === "ItemLists") { registry = { ...registry, ...next }; return { rev: registry._rev }; }
      await heldWrites.get(next._id)?.promise;
      const target = next._id.startsWith("overlay-") ? overlayDocs : docs;
      const current = target.get(next._id);
      if (current?._rev !== next._rev) throw Object.assign(new Error("conflict"), { status: 409 });
      const rev = `${Number(current?._rev?.split("-")[0] || 0) + 1}-saved`;
      target.set(next._id, { ...next, _rev: rev });
      return { rev };
    }),
    allDocs: jest.fn(async ({ keys = [] }: { keys?: string[] } = {}) => ({
      rows: keys.map((key) => ({ doc: overlayDocs.get(key) })),
    })),
  };
  return { ...db, docs, overlayDocs, heldReads, heldWrites };
};
const drain = async () => { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); }); };
const present = () => store.getState().undoable.present as {
  itemList: ReturnType<typeof itemListSlice.getInitialState>;
  itemLists: ReturnType<typeof itemListsSlice.getInitialState>;
  overlays: ReturnType<typeof overlaysSlice.getInitialState>;
};
const Consumer = () => {
  useControllerPageLifecycle();
  const content = useSelector((state) => state.undoable.present);
  const binding = useSelector((state) => state.servicePlanningImport.outlinePlanBinding);
  return <><span data-testid="selection">{content.itemLists.selectedList?._id}</span>
    <span data-testid="items">{content.itemList.list.map((row) => row.name).join(",")}</span>
    <span data-testid="overlays">{content.overlays.list.map((row) => row.id).join(",")}</span>
    <span data-testid="binding">{binding?.planKey}</span></>;
};
const mount = (showOverlays = false) => {
  let context = createMockControllerContext({ db: mockDatabase as unknown as PouchDB.Database, bootstrapReady: false });
  const Tree = () => <Provider store={store}><ControllerInfoContext.Provider value={context}><MemoryRouter><Consumer />{showOverlays && <Overlays />}</MemoryRouter></ControllerInfoContext.Provider></Provider>;
  const view = render(<Tree />);
  return { ...view, updater: context.updater, openOverlays: () => { showOverlays = true; view.rerender(<Tree />); }, changeDatabase: () => {
    context = createMockControllerContext({ db: mockDatabase as unknown as PouchDB.Database, bootstrapReady: false });
    view.rerender(<Tree />);
  } };
};
const select = (id: string) => act(() => { store.dispatch(itemListsSlice.actions.selectItemList(id)); });
const edit = (name: string, fields = "both") => act(() => {
  // Overlay membership changes refer to existing library documents.
  mockDatabase?.overlayDocs.set(`overlay-${name}`, { ...details(name), ...overlay(name), _id: `overlay-${name}` });
  if (fields !== "overlays") store.dispatch(itemListSlice.actions.updateItemList([item(name)]));
  if (fields !== "items") store.dispatch(overlaysSlice.actions.updateOverlayList([overlay(name)]));
});

describe("outline switching with real reducers, listeners and PouchDB boundaries", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockDatabase = database();
    store.dispatch({ type: "RESET" });
    store.dispatch(itemListsSlice.actions.initiateItemLists([{ _id: "a", name: "A" }, { _id: "b", name: "B" }]));
    mockPublish.mockClear();
  });
  afterEach(async () => {
    cleanup();
    await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
    jest.useRealTimers();
  });

  it.each(["items", "overlays", "both"])("loads B while A's %s save is held, then keeps B edits when A finishes", async (fields) => {
    const db = mockDatabase!;
    mount(); await drain();
    const holdA = deferred<void>(); db.heldWrites.set("a", holdA);
    edit("draft-a", fields);
    await act(async () => { await jest.advanceTimersByTimeAsync(1500); });
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ _id: "a" }));
    select("b"); await drain();
    expect(screen.getByTestId("items")).toHaveTextContent(/^b$/);
    expect(screen.getByTestId("overlays")).toHaveTextContent(/^b$/);
    expect(screen.getByTestId("binding")).toHaveTextContent("plan-b");
    edit("draft-b");
    const holdB = deferred<void>(); db.heldWrites.set("b", holdB);
    await act(async () => { await jest.advanceTimersByTimeAsync(1500); });
    mockPublish.mockClear();
    holdA.resolve(); await drain();
    expect(present().itemList.hasPendingUpdate).toBe(true);
    expect(present().overlays.hasPendingUpdate).toBe(true);
    expect(screen.getByTestId("items")).toHaveTextContent("draft-b");
    expect(screen.getByTestId("overlays")).toHaveTextContent("draft-b");
    expect(mockPublish).not.toHaveBeenCalled();
    holdB.resolve(); await drain();
    expect(db.docs.get("b")?.items).toEqual([item("draft-b")]);
    expect(db.docs.get("b")?.overlays).toEqual(["draft-b"]);
    expect(db.docs.get("a")?.items).toEqual([item(fields === "overlays" ? "a" : "draft-a")]);
    expect(db.docs.get("a")?.overlays).toEqual([fields === "items" ? "a" : "draft-a"]);
    expect(present().itemList.hasPendingUpdate).toBe(false);
    expect(present().overlays.hasPendingUpdate).toBe(false);
  });

  it("clears old rows and binding atomically during B's read and after failure", async () => {
    const db = mockDatabase!;
    mount(); await drain();
    const read = deferred<DBItemListDetails>(); db.heldReads.set("b", read);
    const mismatches: string[] = [];
    const unsubscribe = store.subscribe(() => {
      if (present().itemLists.selectedList?._id === "b") mismatches.push(present().itemList.list.map((row) => row.name).join(","));
    });
    select("b");
    expect(present().itemList.list).toEqual([]);
    expect(present().overlays.list).toEqual([]);
    expect(store.getState().servicePlanningImport.outlinePlanBinding).toBeNull();
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    read.reject(new Error("offline read failed")); await drain();
    expect(screen.getByTestId("items")).toBeEmptyDOMElement();
    expect(screen.getByTestId("overlays")).toBeEmptyDOMElement();
    expect(mismatches).not.toContain("a");
    expect(present().itemList.isInitialized).toBe(false);
    unsubscribe(); log.mockRestore();
  });

  it("hides A's editable overlay while B loads, fails, and when the overlay UI mounts after switching", async () => {
    const db = mockDatabase!;
    const view = mount(); await drain();
    act(() => { store.dispatch(overlaySlice.actions.selectOverlay(overlay("a"))); });
    const read = deferred<DBItemListDetails>(); db.heldReads.set("b", read);
    select("b");
    view.openOverlays();
    expect(screen.getByRole("textbox", { name: "Overlay editor", hidden: true })).not.toBeVisible();
    expect(screen.getByRole("textbox", { name: "Overlay editor", hidden: true })).toBeDisabled();
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    read.reject(new Error("offline")); await drain();
    expect(screen.getByRole("textbox", { name: "Overlay editor", hidden: true })).not.toBeVisible();
    expect(screen.getByRole("textbox", { name: "Overlay editor", hidden: true })).toBeDisabled();
    log.mockRestore();
  });

  it("does not show an old database's selected overlay with the same ID in the new database", async () => {
    const view = mount(true); await drain();
    act(() => { store.dispatch(overlaySlice.actions.selectOverlay(overlay("a"))); });
    expect(screen.getByRole("textbox", { name: "Overlay editor" })).toHaveValue("a");
    mockDatabase = database(); view.changeDatabase(); await drain();
    expect(screen.getByRole("textbox", { name: "Overlay editor", hidden: true })).not.toBeVisible();
    expect(screen.getByRole("textbox", { name: "Overlay editor", hidden: true })).toBeDisabled();
    act(() => { store.dispatch(overlaySlice.actions.selectOverlay({ ...overlay("a"), name: "New owner" })); });
    expect(screen.getByRole("textbox", { name: "Overlay editor" })).toHaveValue("New owner");
  });

  it("keeps the hidden overlay editor's accepted draft on its original database", async () => {
    const oldDb = mockDatabase!;
    const view = mount(true); await drain();
    act(() => { store.dispatch(overlaySlice.actions.selectOverlay(overlay("a"))); });
    fireEvent.change(screen.getByRole("textbox", { name: "Overlay editor" }), { target: { value: "Accepted draft" } });
    mockDatabase = database(); view.changeDatabase(); await drain();
    await act(async () => { await jest.advanceTimersByTimeAsync(300); });
    expect(oldDb.overlayDocs.get("overlay-a")?.name).toBe("Accepted draft");
    expect(mockDatabase.overlayDocs.get("overlay-a")?.name).toBe("a");
    expect(mockDatabase.put).not.toHaveBeenCalled();
    expect(present().overlays.list[0]?.name).toBe("a");
    expect(screen.getByRole("textbox", { name: "Overlay editor", hidden: true })).not.toBeVisible();
  });

  it.each(["items", "overlays", "both"])("fully initializes B's empty %s and keeps overlay history", async (field) => {
    const db = mockDatabase!;
    const b = db.docs.get("b")!;
    db.docs.set("b", { ...b, items: field === "overlays" ? b.items : [], overlays: field === "items" ? b.overlays : [] });
    mount(); await drain();
    act(() => { store.dispatch(overlaysSlice.actions.mergeOverlayHistoryFromDb({ "participant.name": ["History"] })); });
    edit("draft-a"); select("b"); await drain();
    expect(present().itemList.list).toEqual(field === "overlays" ? [item("b")] : []);
    expect(present().overlays.list.map((row) => row.id)).toEqual(field === "items" ? ["b"] : []);
    expect(present().overlays.initialList).toEqual(field === "items" ? ["b"] : []);
    expect(present().overlays.hasPendingUpdate).toBe(false);
    expect(present().overlays.isInitialized).toBe(true);
    expect(present().overlays.overlayHistory["participant.name"]).toEqual(["History"]);
  });

  it("preserves B drafts during registry refresh and remote update", async () => {
    const view = mount(); await drain(); select("b"); await drain(); edit("draft-b");
    act(() => { store.dispatch(itemListsSlice.actions.updateItemListsFromRemote([{ _id: "a", name: "A" }, { _id: "b", name: "Renamed B" }])); });
    await drain();
    act(() => { view.updater.dispatchEvent(new CustomEvent("update", { detail: [{ ...details("b"), items: [item("remote-b")], overlays: ["remote-b"] }] })); });
    await drain();
    expect(screen.getByTestId("items")).toHaveTextContent("draft-b");
    expect(screen.getByTestId("overlays")).toHaveTextContent("draft-b");
    expect(present().itemList.hasPendingUpdate).toBe(true);
    expect(present().overlays.hasPendingUpdate).toBe(true);
  });

  it("keeps B edits made while a same-outline refresh read is pending", async () => {
    const db = mockDatabase!;
    mount(); await drain(); select("b"); await drain();
    const read = deferred<DBItemListDetails>(); db.heldReads.set("b", read);
    act(() => { store.dispatch(itemListsSlice.actions.updateItemListsFromRemote([{ _id: "a", name: "A" }, { _id: "b", name: "Refreshed B" }])); });
    await drain(); edit("draft-b"); read.resolve(details("b")); await drain();
    expect(screen.getByTestId("items")).toHaveTextContent("draft-b");
    expect(screen.getByTestId("overlays")).toHaveTextContent("draft-b");
    expect(present().itemList.hasPendingUpdate).toBe(true);
    expect(present().overlays.hasPendingUpdate).toBe(true);
  });

  it("ignores an old A read after A -> B -> A before React rerenders", async () => {
    const db = mockDatabase!;
    const oldRead = deferred<DBItemListDetails>(); db.heldReads.set("a", oldRead);
    mount(); await drain();
    db.docs.set("a", { ...details("a"), items: [item("fresh-a")] });
    act(() => {
      store.dispatch(itemListsSlice.actions.selectItemList("b"));
      store.dispatch(itemListsSlice.actions.selectItemList("a"));
    });
    await drain();
    expect(screen.getByTestId("items")).toHaveTextContent("fresh-a");
    oldRead.resolve(details("a")); await drain();
    expect(screen.getByTestId("items")).toHaveTextContent("fresh-a");
  });

  it("never restores A's content into B through undo after switching", async () => {
    mount(); await drain(); edit("draft-a"); select("b"); await drain();
    act(() => { store.dispatch({ type: "CONTROLLER_PAGE_READY" }); });
    edit("draft-b");
    act(() => { store.dispatch(ActionCreators.undo()); });
    expect(present().itemLists.selectedList?._id).toBe("b");
    expect(present().itemList.list.map((row) => row.name)).not.toContain("draft-a");
    expect(present().overlays.list.map((row) => row.id)).not.toContain("draft-a");
  });

  it("restores A's unsaved draft on rapid A -> B -> A and ignores B's delayed read", async () => {
    const db = mockDatabase!;
    mount(); await drain();
    const write = deferred<void>(); db.heldWrites.set("a", write);
    edit("draft-a");
    const readB = deferred<DBItemListDetails>(); db.heldReads.set("b", readB);
    select("b"); await drain(); select("a"); await drain();
    expect(screen.getByTestId("items")).toHaveTextContent("draft-a");
    expect(screen.getByTestId("overlays")).toHaveTextContent("draft-a");
    readB.resolve(details("b")); await drain();
    expect(screen.getByTestId("selection")).toHaveTextContent("a");
    expect(screen.getByTestId("items")).toHaveTextContent("draft-a");
    write.resolve(); await drain();
    expect(db.docs.get("a")?.items).toEqual([item("draft-a")]);
    expect(db.docs.get("a")?.overlays).toEqual(["draft-a"]);
    expect(db.docs.get("b")?.items).toEqual([item("b")]);
    expect(db.docs.get("b")?.overlays).toEqual(["b"]);
  });

  it("does not resurrect a retained older draft after a reopened outline saves newer edits", async () => {
    const db = mockDatabase!;
    mount(); await drain();
    const write = deferred<void>(); db.heldWrites.set("a", write);
    edit("older-a"); select("b"); await drain();
    select("a"); await drain(); edit("newer-a");
    await act(async () => { await jest.advanceTimersByTimeAsync(1500); });
    write.resolve(); await drain();
    expect(present().itemList.hasPendingUpdate).toBe(false);
    expect(present().overlays.hasPendingUpdate).toBe(false);
    select("b"); await drain(); select("a"); await drain();
    expect({ selected: present().itemLists.selectedList?._id, items: present().itemList.list, persisted: db.docs.get("a")?.items, loading: present().itemList.isLoading, initialized: present().itemList.isInitialized }).toEqual({ selected: "a", items: [item("newer-a")], persisted: [item("newer-a")], loading: false, initialized: true });
    expect(screen.getByTestId("overlays")).toHaveTextContent("newer-a");
    expect(present().itemList.hasPendingUpdate).toBe(false);
    expect(present().overlays.hasPendingUpdate).toBe(false);
  });

  it.each(["scope", "remote reselection"])("flushes outgoing drafts on %s without waiting to load B", async (transition) => {
    const db = mockDatabase!;
    mount(); await drain();
    const write = deferred<void>(); db.heldWrites.set("a", write);
    edit("draft-a");
    act(() => {
      store.dispatch(itemListsSlice.actions.updateItemLists([{ _id: "a", name: "A" }, { _id: "b", name: "B", controllerScope: "aux" }]));
      store.dispatch(transition === "scope" ? itemListsSlice.actions.setOutlineScope("aux") : itemListsSlice.actions.updateItemListsFromRemote([{ _id: "b", name: "B" }]));
    });
    await drain();
    expect(screen.getByTestId("items")).toHaveTextContent(/^b$/);
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ _id: "a", items: [item("draft-a")] }));
    write.resolve(); await drain();
    expect(db.docs.get("a")?.items).toEqual([item("draft-a")]);
    expect(db.docs.get("a")?.overlays).toEqual(["draft-a"]);
    expect(screen.getByTestId("items")).toHaveTextContent(/^b$/);
  });

  it("keeps same-ID database content and pending flags separate from late old saves", async () => {
    const oldDb = mockDatabase!;
    const view = mount(); await drain();
    const write = deferred<void>(); oldDb.heldWrites.set("a", write);
    edit("old-draft");
    await act(async () => { await jest.advanceTimersByTimeAsync(1500); });
    mockDatabase = database();
    mockDatabase.docs.set("a", { ...details("a"), items: [item("new-owner")], overlays: ["new-owner"] });
    view.changeDatabase(); await drain();
    expect(screen.getByTestId("items")).toHaveTextContent("new-owner");
    edit("new-draft"); mockPublish.mockClear(); write.resolve(); await drain();
    expect(screen.getByTestId("items")).toHaveTextContent("new-draft");
    expect(present().itemList.hasPendingUpdate).toBe(true);
    expect(present().overlays.hasPendingUpdate).toBe(true);
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockDatabase.put).not.toHaveBeenCalled();
    expect(oldDb.docs.get("a")?.items).toEqual([item("old-draft")]);
    expect(oldDb.docs.get("a")?.overlays).toEqual(["old-draft"]);
  });

  it("ignores a delayed read from the old database with the same outline ID", async () => {
    const oldDb = mockDatabase!;
    const read = deferred<DBItemListDetails>(); oldDb.heldReads.set("a", read);
    const view = mount(); await drain();
    mockDatabase = database();
    mockDatabase.docs.set("a", { ...details("a"), items: [item("new-owner")] });
    view.changeDatabase(); await drain(); edit("new-draft");
    read.resolve(details("a")); await drain();
    expect(screen.getByTestId("items")).toHaveTextContent("new-draft");
    expect(screen.getByTestId("overlays")).toHaveTextContent("new-draft");
    expect(present().itemList.hasPendingUpdate).toBe(true);
    expect(present().overlays.hasPendingUpdate).toBe(true);
  });

  it("finishes entered field writes after lifecycle unmount without publishing retired content", async () => {
    const db = mockDatabase!;
    const view = mount(); await drain();
    const write = deferred<void>(); db.heldWrites.set("a", write);
    edit("outgoing-draft");
    await act(async () => { await jest.advanceTimersByTimeAsync(1500); });
    view.unmount(); mockPublish.mockClear(); write.resolve(); await drain();
    expect(db.docs.get("a")?.items).toEqual([item("outgoing-draft")]);
    expect(db.docs.get("a")?.overlays).toEqual(["outgoing-draft"]);
    expect(present().itemList.list).toEqual([]);
    expect(present().overlays.list).toEqual([]);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it.each([
    ["items", false], ["items", true], ["overlays", false], ["overlays", true], ["both", false], ["both", true],
  ] as const)("retries failed A %s alongside outgoing B (B dirty: %s)", async (field, bDirty) => {
    const db = mockDatabase!;
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    mount(); await drain();
    const persist = db.put.getMockImplementation()!;
    let rejectA = true;
    db.put.mockImplementation((next) => rejectA && next._id === "a" ? Promise.reject(new Error("temporary disk failure")) : persist(next));
    edit("retry-draft", field); select("b"); await drain(); rejectA = false;
    expect(screen.getByTestId("items")).toHaveTextContent(/^b$/);
    if (bDirty) edit("outgoing-b");
    select("a"); await drain();
    expect(present().itemList.list).toEqual([item(field === "overlays" ? "a" : "retry-draft")]);
    expect(present().overlays.list.map((row) => row.id)).toEqual([field === "items" ? "a" : "retry-draft"]);
    expect(present().itemList.hasPendingUpdate).toBe(field !== "overlays");
    expect(present().overlays.hasPendingUpdate).toBe(field !== "items");
    await act(async () => { await jest.advanceTimersByTimeAsync(1500); });
    expect(db.docs.get("a")?.items).toEqual([item(field === "overlays" ? "a" : "retry-draft")]);
    expect(db.docs.get("a")?.overlays).toEqual([field === "items" ? "a" : "retry-draft"]);
    expect(present().itemList.hasPendingUpdate).toBe(false);
    expect(present().overlays.hasPendingUpdate).toBe(false);
    expect(db.docs.get("b")?.items).toEqual([item(bDirty ? "outgoing-b" : "b")]);
    expect(db.docs.get("b")?.overlays).toEqual([bDirty ? "outgoing-b" : "b"]);
    log.mockRestore();
  });
});
