import { act, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import ControllerInfoProvider from "./controllerInfo";
import { GlobalInfoContext } from "./globalInfo";
import { ToastProvider } from "./toastContext";
import { useSelector } from "../hooks";
import store from "../store/store";
import { createMockGlobalContext } from "../test/mocks";
import Outlines from "../containers/Toolbar/ToolbarElements/Outlines";
import { useControllerPageLifecycle } from "../pages/Controller/useControllerPageLifecycle";
import { preferencesClusterLoadFallback, setDefaultSongBackgroundBrightness } from "../store/preferencesSlice";
import { itemListSlice } from "../store/itemListSlice";
import { itemListsSlice } from "../store/itemListsSlice";
import { PREFERENCES_POUCH_ID, QUICK_LINKS_POUCH_ID, MONITOR_SETTINGS_POUCH_ID, getControllerMediaRouteFoldersDocId } from "../types";
import type { ItemList } from "../types";

const mockDocs = new Map<string, Record<string, unknown>>();
const mockPut = jest.fn(async (doc: Record<string, unknown>) => {
  if (mockDocs.has(String(doc._id)) && !doc._rev) throw Object.assign(new Error("conflict"), { status: 409 });
  mockDocs.set(String(doc._id), doc);
  return { rev: "1-created" };
});
const mockGet = jest.fn(async (id: string) => {
  if (!mockDocs.has(id)) throw Object.assign(new Error("missing"), { status: 404 });
  return mockDocs.get(id);
});
const mockPulls: Array<{ emit: (event: string, value?: unknown) => void }> = [];
// The default Jest mapper replaces controllerInfo for component tests. These
// consumers must share the actual provider/context to exercise early DB access.
jest.mock("../context/controllerInfo", () => jest.requireActual("./controllerInfo"));
const mockHandle = () => {
  const listeners = new Map<string, (value?: unknown) => void>();
  const handle = {
    on: (event: string, fn: (value?: unknown) => void) => { listeners.set(event, fn); return handle; },
    cancel: jest.fn(), emit: (event: string, value?: unknown) => listeners.get(event)?.(value),
  };
  return handle;
};
jest.mock("pouchdb-browser", () => ({ __esModule: true, default: jest.fn((name: string) => ({
  name, get: mockGet, put: mockPut, destroy: jest.fn().mockResolvedValue(undefined),
  allDocs: jest.fn(async () => ({ rows: [], update_seq: 0 })), changes: mockHandle, sync: mockHandle,
  replicate: { to: (_target: unknown, options: { batch_size?: number }) => {
    const handle = mockHandle();
    if (options.batch_size === 150) mockPulls.push(handle);
    return handle;
  } },
})) }));
jest.mock("../hooks/useGlobalBroadcast", () => ({ useGlobalBroadcast: jest.fn() }));
jest.mock("../utils/mediaDocUtils", () => ({
  ...jest.requireActual("../utils/mediaDocUtils"),
  loadMediaLibrary: jest.fn().mockResolvedValue({ list: [], folders: [] }),
  requireMediaLibraryV2: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../utils/dbUtils", () => ({
  ...jest.requireActual("../utils/dbUtils"),
  getAllOverlayHistory: jest.fn().mockResolvedValue([]), getOverlaysByIds: jest.fn().mockResolvedValue([]),
}));

const Consumers = () => {
  useControllerPageLifecycle();
  const brightness = useSelector((state) => state.undoable.present.preferences.preferences.defaultSongBackgroundBrightness);
  const routes = useSelector((state) => state.undoable.present.preferences.mediaRouteFolders);
  const itemName = useSelector((state) => state.undoable.present.itemList.list[0]?.name);
  return <><Outlines /><span data-testid="brightness">{brightness}</span><span data-testid="folder">{routes["controller-default"]}</span><span data-testid="item">{itemName}</span></>;
};

const seedSaved = () => {
  mockDocs.set("ItemLists", { _id: "ItemLists", itemLists: [{ _id: "saved", name: "Saved Sunday" }], activeList: { _id: "saved", name: "Saved Sunday" } });
  mockDocs.set("saved", { _id: "saved", items: [{ _id: "song", type: "song", name: "Saved song" }], overlays: [] });
  mockDocs.set(PREFERENCES_POUCH_ID, { _id: PREFERENCES_POUCH_ID, preferences: { ...preferencesClusterLoadFallback.preferences, defaultSongBackgroundBrightness: 83 } });
  mockDocs.set(QUICK_LINKS_POUCH_ID, { _id: QUICK_LINKS_POUCH_ID, quickLinks: [] });
  mockDocs.set(MONITOR_SETTINGS_POUCH_ID, { _id: MONITOR_SETTINGS_POUCH_ID, monitorSettings: preferencesClusterLoadFallback.monitorSettings });
  const routeId = getControllerMediaRouteFoldersDocId("presentation");
  mockDocs.set(routeId, { _id: routeId, controllerProfileId: "presentation", mediaRouteFolders: { "controller-default": "saved-folder" } });
};
const mount = () => render(<Provider store={store}><GlobalInfoContext.Provider value={createMockGlobalContext({ firebaseDb: undefined }) as never}>
  <MemoryRouter initialEntries={["/controller"]}><ToastProvider><ControllerInfoProvider><Consumers /></ControllerInfoProvider></ToastProvider></MemoryRouter>
</GlobalInfoContext.Provider></Provider>);

describe("controller bootstrap production consumers", () => {
  beforeEach(() => {
    store.dispatch({ type: "RESET" });
    mockDocs.clear(); mockPut.mockClear(); mockGet.mockClear(); mockPulls.length = 0;
    global.fetch = jest.fn().mockResolvedValue({ headers: { get: () => "application/json" }, json: async () => ({ success: true }) });
    global.BroadcastChannel = jest.fn(() => ({ close: jest.fn(), postMessage: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn() })) as unknown as typeof BroadcastChannel;
  });
  it("shows delayed remote outlines, details, preferences and scoped routes without navigation or default writes", async () => {
    mount();
    await waitFor(() => expect(mockPulls).toHaveLength(1));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("ItemLists"));
    expect(mockPut).not.toHaveBeenCalled();
    seedSaved();
    act(() => mockPulls[0].emit("complete", { ok: true }));
    await screen.findAllByRole("button", { name: "Saved Sunday" });
    await waitFor(() => expect(screen.getByTestId("brightness")).toHaveTextContent("83"));
    await waitFor(() => expect(screen.getByTestId("folder")).toHaveTextContent("saved-folder"));
    await waitFor(() => expect(screen.getByTestId("item")).toHaveTextContent("Saved song"));
    expect(mockPut).not.toHaveBeenCalled();
  });
  it("keeps saved local content available while the first remote pull stalls", async () => {
    seedSaved();
    mount();
    await screen.findAllByRole("button", { name: "Saved Sunday" });
    await waitFor(() => expect(screen.getByTestId("brightness")).toHaveTextContent("83"));
    expect(screen.getByTestId("folder")).toHaveTextContent("saved-folder");
    expect(mockPut).not.toHaveBeenCalled();
  });
  it("checks the replicated aux registry before automatically creating an outline for an empty Redux scope", async () => {
    seedSaved();
    mount();
    await screen.findAllByRole("button", { name: "Saved Sunday" });
    act(() => { store.dispatch(itemListsSlice.actions.setOutlineScope("aux")); });
    expect(mockPut).not.toHaveBeenCalled();
    const registry = mockDocs.get("ItemLists")!;
    mockDocs.set("ItemLists", { ...registry, itemLists: [
      { _id: "saved", name: "Saved Sunday" }, { _id: "saved-aux", name: "Saved Aux", controllerScope: "aux" },
    ] });
    mockDocs.set("saved-aux", { _id: "saved-aux", name: "Saved Aux", items: [], overlays: [] });
    act(() => mockPulls[0].emit("complete", { ok: true }));
    await screen.findAllByRole("button", { name: "Saved Aux" });
    expect(mockPut).not.toHaveBeenCalled();
  });
  it("creates defaults once after a successful empty remote pull", async () => {
    mount();
    await waitFor(() => expect(mockPulls).toHaveLength(1));
    expect(mockPut).not.toHaveBeenCalled();
    act(() => mockPulls[0].emit("complete", { ok: true }));
    await screen.findAllByRole("button", { name: "New Outline" });
    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(6));
    expect(new Set(mockPut.mock.calls.map(([doc]) => doc._id)).size).toBe(6);
  });
  it("initializes a genuinely empty aux scope after verified registry hydration", async () => {
    mount();
    await waitFor(() => expect(mockPulls).toHaveLength(1));
    act(() => { store.dispatch(itemListsSlice.actions.setOutlineScope("aux")); });
    expect(mockPut).not.toHaveBeenCalled();
    act(() => mockPulls[0].emit("complete", { ok: true }));
    await waitFor(() => expect(store.getState().undoable.present.itemLists.currentLists.filter((list: ItemList) => list.controllerScope === "aux")).toHaveLength(1));
    expect(store.getState().undoable.present.itemLists.selectedList?.controllerScope).toBe("aux");
  });

  it("does not register or select an auxiliary outline before its detail write succeeds", async () => {
    seedSaved();
    const originalPut = mockPut.getMockImplementation()!;
    let entered!: () => void;
    let rejectWrite!: (error: Error) => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
    const error = new Error("Auxiliary outline detail write failed");
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockPut.mockImplementation((doc) => {
      if (doc._id !== "New Outline") return originalPut(doc);
      entered();
      const write = gate.then(() => originalPut(doc));
      void write.catch(() => undefined);
      return write;
    });
    const view = mount();
    await screen.findAllByRole("button", { name: "Saved Sunday" });
    act(() => { store.dispatch(itemListsSlice.actions.setOutlineScope("aux")); });
    const before = store.getState().undoable.present.itemLists;
    act(() => mockPulls[0].emit("complete", { ok: true }));
    await act(async () => { await started; await Promise.resolve(); });
    const pending = store.getState().undoable.present.itemLists;
    await act(async () => { rejectWrite(error); await gate.catch(() => undefined); });
    const after = store.getState().undoable.present.itemLists;
    view.unmount();
    mockPut.mockImplementation(originalPut);
    log.mockRestore();
    expect(pending.currentLists).toEqual(before.currentLists);
    expect(pending.selectedList).toEqual(before.selectedList);
    expect(after.currentLists).toEqual(before.currentLists);
    expect(after.selectedList).toEqual(before.selectedList);
    expect(mockDocs.has("New Outline")).toBe(false);
  });

  it("refreshes saved values after the pull while preserving operator edits made offline", async () => {
    jest.useFakeTimers();
    seedSaved();
    const view = mount();
    await screen.findAllByRole("button", { name: "Saved Sunday" });
    await waitFor(() => expect(screen.getByTestId("item")).toHaveTextContent("Saved song"));
    act(() => {
      store.dispatch(setDefaultSongBackgroundBrightness(91));
      store.dispatch(itemListSlice.actions.updateItemList([{ _id: "edited", name: "Operator edit", type: "song" } as never]));
    });
    const routeId = getControllerMediaRouteFoldersDocId("presentation");
    mockDocs.set(routeId, { _id: routeId, controllerProfileId: "presentation", mediaRouteFolders: { "controller-default": "new-remote-folder" } });
    act(() => mockPulls[0].emit("complete", { ok: true }));
    await waitFor(() => expect(screen.getByTestId("folder")).toHaveTextContent("new-remote-folder"));
    expect(screen.getByTestId("brightness")).toHaveTextContent("91");
    expect(screen.getByTestId("item")).toHaveTextContent("Operator edit");
    expect(store.getState().undoable.present.itemList.hasPendingUpdate).toBe(true);
    view.unmount();
    jest.useRealTimers();
  });
});
