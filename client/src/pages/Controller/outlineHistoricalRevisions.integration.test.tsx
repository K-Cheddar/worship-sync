import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import PouchDB from "pouchdb-browser";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import store from "../../store/store";
import { itemListSlice } from "../../store/itemListSlice";
import { itemListsSlice } from "../../store/itemListsSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { createMockControllerContext, createMockGlobalContext } from "../../test/mocks";
import { useControllerPageLifecycle } from "./useControllerPageLifecycle";
import { ChurchServiceTimeZoneProvider } from "../../context/churchServiceTimeZone";
import ServiceItems from "../../containers/ServiceItems/ServiceItems";
import type { DBItemListDetails, ServiceItem } from "../../types";

// eslint-disable-next-line no-var
var mockDatabase: PouchDB.Database | undefined;
jest.mock("../../context/controllerInfo", () => ({
  ControllerInfoContext: jest.requireActual("react").createContext(null),
  get globalDb() { return mockDatabase; },
  globalBroadcastRef: { postMessage: jest.fn() },
}));
jest.mock("../../context/globalInfo", () => ({
  GlobalInfoContext: jest.requireActual("react").createContext(null),
  globalFireDbInfo: { churchId: "church", database: "test" },
}));
jest.mock("../../hooks/useGlobalBroadcast", () => ({ useGlobalBroadcast: jest.fn() }));
jest.mock("../../hooks/useSyncOnReconnect", () => ({ useSyncOnReconnect: jest.fn() }));
jest.mock("../../context/toastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock("../../utils/controllerBootstrapDocs", () => ({ loadOrCreatePreferencesBundle: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../utils/controllerMediaRouteFolders", () => ({ loadOrCreateControllerMediaRouteFolders: jest.fn().mockResolvedValue({ mediaRouteFolders: {} }) }));
jest.mock("../../utils/mediaDocUtils", () => ({
  ...jest.requireActual("../../utils/mediaDocUtils"),
  loadMediaLibrary: jest.fn().mockResolvedValue({ list: [], folders: [] }),
  requireMediaLibraryV2: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("firebase/database", () => ({ ref: jest.fn(), onValue: jest.fn() }));
jest.mock("../../containers/ServiceItems/ServiceItem", () => ({ item }: { item: ServiceItem }) => <div>{item.name}</div>);
jest.mock("../../containers/Toolbar/ToolbarElements/Outlines", () => () => null);

const rows = (count: number, prefix: string): ServiceItem[] => Array.from({ length: count }, (_, i) => ({
  _id: `song-${i}`, listId: `row-${i}`, name: `${prefix} ${i + 1}`, type: "song", background: "https://example.test/image.jpg",
}));
const state = () => store.getState().undoable.present.itemList;
const Lifecycle = () => { useControllerPageLifecycle(); return <ServiceItems />; };
const select = (id: string) => act(() => { store.dispatch(itemListsSlice.actions.selectItemList(id)); });

it.each(["full", "view"])("loads the 87-row winner cleanly across switching, remount/reset and replication (%s)", async (access) => {
  const prefix = `controller-history-${Date.now()}-${Math.random()}`;
  const a = new PouchDB(`${prefix}-a`); const b = new PouchDB(`${prefix}-b`); const c = new PouchDB(`${prefix}-c`);
  mockDatabase = a;
  try {
    await a.put({ _id: "outline", name: "Sunday", items: rows(87, "Winning"), overlays: [] });
    await Promise.all([b.replicate.from(a), c.replicate.from(a)]);
    const base = await a.get<DBItemListDetails>("outline");
    await b.put({ ...base, items: rows(38, "Historical B") });
    await c.put({ ...base, items: rows(38, "Historical C") });
    const written = await a.put({ ...base, items: rows(87, "Winning") });
    await a.put({ ...base, _rev: written.rev, items: rows(87, "Winning") });
    await a.replicate.from(b); await a.replicate.from(c);
    await a.put({ _id: "other", name: "Other", items: rows(1, "Other"), overlays: [] });
    const initial = await a.get<DBItemListDetails>("outline", { conflicts: true });
    const leaves = initial._conflicts!;
    expect(leaves).toHaveLength(2);
    const put = jest.spyOn(a, "put"); const remove = jest.spyOn(a, "remove");
    const context = createMockControllerContext({ db: a, bootstrapReady: false });
    const global = createMockGlobalContext({ access, firebaseDb: undefined });
    const init = () => act(() => {
      store.dispatch({ type: "RESET" });
      store.dispatch(itemListsSlice.actions.initiateItemLists([{ _id: "outline", name: "Sunday" }, { _id: "other", name: "Other" }]));
    });
    const mount = () => render(<Provider store={store}><GlobalInfoContext.Provider value={global}><ControllerInfoContext.Provider value={context}><ChurchServiceTimeZoneProvider><MemoryRouter><Lifecycle /></MemoryRouter></ChurchServiceTimeZoneProvider></ControllerInfoContext.Provider></GlobalInfoContext.Provider></Provider>);
    init(); let view = mount();
    await screen.findByText("Winning 87");
    expect(state().list).toHaveLength(87);
    expect(state().hasPendingUpdate).toBe(false);
    expect(state().pendingByOutline ?? {}).toEqual({});
    expect(state().remoteConflicts).toEqual({});
    expect(screen.queryByRole("region", { name: "Review outline changes" })).not.toBeInTheDocument();
    select("other");
    expect(state().loadedOutlineId).toBeUndefined();
    expect(state().syncBaseline).toEqual([]);
    await screen.findByText("Other 1");
    select("outline"); await screen.findByText("Winning 87");
    view.unmount();
    act(() => { store.dispatch(itemListsSlice.actions.initiateItemLists([{ _id: "outline", name: "Sunday" }, { _id: "other", name: "Other" }])); });
    view = mount(); await screen.findByText("Winning 87");
    view.unmount(); init(); view = mount(); await screen.findByText("Winning 87");
    expect(state().hasPendingUpdate).toBe(false);
    expect(state().pendingByOutline ?? {}).toEqual({});
    expect(put.mock.calls.filter(([doc]) => !doc._id?.startsWith("_local/"))).toHaveLength(0); expect(remove).not.toHaveBeenCalled();
    expect((await a.get("outline", { conflicts: true }))._rev).toBe(initial._rev);
    await b.replicate.from(a);
    const latest = await b.get<DBItemListDetails>("outline");
    await b.put({ ...latest, items: rows(87, "Replicated") });
    await a.replicate.from(b);
    const replicated = await a.get("outline");
    await act(async () => { context.updater.dispatchEvent(new CustomEvent("update", { detail: [replicated] })); });
    await screen.findByText("Replicated 87");
    expect(state().hasPendingUpdate).toBe(false);
    expect(state().remoteConflicts).toEqual({});
    expect(put.mock.calls.filter(([doc]) => !doc._id?.startsWith("_local/"))).toHaveLength(0); expect(remove).not.toHaveBeenCalled();
    expect((await a.get("outline", { conflicts: true }))._conflicts).toEqual(leaves);
    const historical = await Promise.all(leaves.map((rev) => a.get<DBItemListDetails>("outline", { rev })));
    expect(historical.map((doc) => doc.items.length)).toEqual([38, 38]);
    view.unmount();
  } finally { cleanup(); mockDatabase = undefined; await Promise.all([a.destroy(), b.destroy(), c.destroy()]); }
});

it("saves intentional delete-all through the supported editing action after initialization", async () => {
  const a = new PouchDB(`controller-delete-all-${Date.now()}-${Math.random()}`); mockDatabase = a;
  try {
    await a.put({ _id: "outline", name: "Sunday", items: rows(2, "Winning"), overlays: [] });
    act(() => { store.dispatch({ type: "RESET" }); store.dispatch(itemListsSlice.actions.initiateItemLists([{ _id: "outline", name: "Sunday" }])); });
    const context = createMockControllerContext({ db: a, bootstrapReady: false });
    render(<Provider store={store}><GlobalInfoContext.Provider value={createMockGlobalContext({ access: "full", firebaseDb: undefined })}><ControllerInfoContext.Provider value={context}><ChurchServiceTimeZoneProvider><MemoryRouter><Lifecycle /></MemoryRouter></ChurchServiceTimeZoneProvider></ControllerInfoContext.Provider></GlobalInfoContext.Provider></Provider>);
    await screen.findByText("Winning 2");
    act(() => { store.dispatch(itemListSlice.actions.removeItemsFromList(state().list.map((row: ServiceItem) => row.listId))); });
    expect(state().hasPendingUpdate).toBe(true);
    await waitFor(async () => expect((await a.get<DBItemListDetails>("outline")).items).toEqual([]), { timeout: 5000 });
    await waitFor(() => expect(state().hasPendingUpdate).toBe(false));
  } finally { cleanup(); mockDatabase = undefined; await a.destroy(); }
});

it("keeps genuine unsaved work visible through failed focused decisions, retry and acknowledgment", async () => {
  const a = new PouchDB(`controller-active-review-${Date.now()}-${Math.random()}`); mockDatabase = a;
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const user = userEvent.setup();
    await a.put({ _id: "outline", name: "Sunday", items: rows(2, "Base"), overlays: [] });
    act(() => { store.dispatch({ type: "RESET" }); store.dispatch(itemListsSlice.actions.initiateItemLists([{ _id: "outline", name: "Sunday" }])); });
    const context = createMockControllerContext({ db: a, bootstrapReady: false });
    render(<Provider store={store}><GlobalInfoContext.Provider value={createMockGlobalContext({ access: "full", firebaseDb: undefined })}><ControllerInfoContext.Provider value={context}><ChurchServiceTimeZoneProvider><MemoryRouter><Lifecycle /></MemoryRouter></ChurchServiceTimeZoneProvider></ControllerInfoContext.Provider></GlobalInfoContext.Provider></Provider>);
    await screen.findByText("Base 2");
    const baseline = state().list;
    const draft = [{ ...baseline[0], name: "My edit" }, baseline[1]];
    act(() => { store.dispatch(itemListSlice.actions.updateItemList(draft)); });
    const current = await a.get<DBItemListDetails>("outline");
    const remote = [{ ...baseline[0], name: "Saved edit" }, { ...baseline[1], name: "Compatible edit" }];
    const result = await a.put({ ...current, items: remote });
    await act(async () => { context.updater.dispatchEvent(new CustomEvent("update", { detail: [{ _id: "outline", _rev: result.rev }] })); });
    await screen.findByRole("region", { name: "Review outline changes" });
    expect(screen.getByText("My edit")).toBeVisible();
    expect(screen.getByText("Compatible edit")).toBeVisible();
    const originalPut = a.put.bind(a);
    const put = jest.spyOn(a, "put").mockRejectedValueOnce(new Error("offline"));
    await user.click(screen.getByRole("button", { name: "Saved edit: Saved edit" }));
    await user.click(screen.getByRole("button", { name: "Save choices" }));
    expect(screen.getByRole("button", { name: "Saving choices" })).toBeDisabled();
    expect(state().list[0].name).toBe("My edit");
    await screen.findByText("Could not save your choice. Your draft is still open. Try your choice again.", {}, { timeout: 5000 });
    expect(state().list[0].name).toBe("My edit");
    put.mockImplementation(originalPut);
    await user.click(screen.getByRole("button", { name: "Save choices" }));
    await waitFor(() => expect(state().remoteConflicts).toEqual({}), { timeout: 5000 });
    expect(state().list).toEqual(remote);
    expect((await a.get<DBItemListDetails>("outline")).items).toEqual(remote);
    expect(state().hasPendingUpdate).toBe(false);
  } finally { cleanup(); mockDatabase = undefined; log.mockRestore(); await a.destroy(); }
});
