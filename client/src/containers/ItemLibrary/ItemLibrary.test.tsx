import { combineReducers, configureStore } from "@reduxjs/toolkit";
import undoable from "redux-undo";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import ItemLibrary from "./ItemLibrary";
import itemLibraryUiReducer from "../../store/itemLibraryUiSlice";
import { hydrateItemCache } from "../../store/allDocsSlice";
import allDocsReducer from "../../store/allDocsSlice";
import itemListReducer, { initiateItemList, updateItemList } from "../../store/itemListSlice";
import timersReducer, { syncTimers } from "../../store/timersSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { globalFireDbInfo, GlobalInfoContext } from "../../context/globalInfo";
import { PresentationControllerModeProvider } from "../../context/presentationControllerMode";
import {
  createMockControllerContext,
  createMockGlobalContext,
} from "../../test/mocks";
import type { DBItem, ServiceItem } from "../../types";

jest.mock("../../context/churchServiceTimeZone", () => ({
  useChurchServiceTimeZone: () => ({
    status: "ready",
    timeZone: "UTC",
    isConfigured: true,
    legacyTimeZoneSuggestion: null,
    refresh: jest.fn(),
  }),
}));

const items: ServiceItem[] = [
  { _id: "song-1", name: "Library Song", type: "song", listId: "song-1" },
  { _id: "custom-1", name: "Library Custom", type: "free", listId: "custom-1" },
  { _id: "timer-1", name: "Library Timer", type: "timer", listId: "timer-1" },
];

const createTestStore = () => {
  const store = configureStore({
    reducer: {
      itemLibraryUi: itemLibraryUiReducer,
      allDocs: allDocsReducer,
      undoable: (
        state = { present: { serviceTimes: { list: [] } } },
      ) => state,
    },
  });
  store.dispatch(hydrateItemCache(items as never));
  return store;
};

const controllerUndoableReducer = undoable(combineReducers({
  itemList: itemListReducer,
  serviceTimes: (state: { list: unknown[] } = { list: [] }) => state,
}));

const createControllerLibraryStore = (documents: DBItem[], outline: ServiceItem[]) => {
  const store = configureStore({
    reducer: {
      itemLibraryUi: itemLibraryUiReducer,
      allDocs: allDocsReducer,
      undoable: controllerUndoableReducer,
      timers: timersReducer,
    },
  });
  store.dispatch(hydrateItemCache(documents as never));
  store.dispatch(initiateItemList({ items: outline, outlineId: "outline-1" }));
  store.dispatch(updateItemList(outline));
  return store;
};

const notFound = (id: string) => Object.assign(new Error(`missing ${id}`), { status: 404 });

const createItemDatabase = (documents: DBItem[]) => {
  const saved = new Map(documents.map((document) => [document._id, { ...document }]));
  const get = jest.fn(async (id: string) => {
    const document = saved.get(id);
    if (!document) throw notFound(id);
    return { ...document };
  });
  const remove = jest.fn(async (document: DBItem) => {
    saved.delete(document._id);
    return { ok: true };
  });
  return { db: { get, remove } as any, saved, get, remove };
};

describe("ItemLibrary route initialization", () => {
  let getBoundingClientRectSpy: jest.SpyInstance;

  beforeEach(() => {
    getBoundingClientRectSpy = jest
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(() =>
        ({
          width: 800,
          height: 600,
          top: 0,
          left: 0,
          bottom: 600,
          right: 800,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
      );
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 600,
    });
  });

  afterEach(() => {
    getBoundingClientRectSpy.mockRestore();
    window.localStorage.removeItem("worshipsync_presentation_controller_mode");
    window.localStorage.removeItem("timerInfo");
    globalFireDbInfo.db = undefined;
    globalFireDbInfo.churchId = "";
    globalFireDbInfo.isConnected = false;
  });

  it.each([
    { path: "/controller/songs", filter: "Songs", visible: "Library Song", hidden: "Library Custom" },
    { path: "/controller/free", filter: "Custom", visible: "Library Custom", hidden: "Library Timer" },
    { path: "/controller/timers", filter: "Timers", visible: "Library Timer", hidden: "Library Song" },
  ])("initializes $filter from $path", async ({ path, filter, visible, hidden }) => {
    render(
      <Provider store={createTestStore()}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext() as any}
        >
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <PresentationControllerModeProvider>
              <MemoryRouter initialEntries={[path]}>
                <ItemLibrary />
              </MemoryRouter>
            </PresentationControllerModeProvider>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: filter })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(await screen.findByTitle(visible)).toBeInTheDocument();
    expect(screen.queryByTitle(hidden)).not.toBeInTheDocument();
  });

  it("shows separate update columns and sorts by clicking column headings", async () => {
    const user = userEvent.setup();
    const documents: DBItem[] = [
      { _id: "custom-alpha", name: "Alpha", type: "free", createdAt: "invalid", updatedAt: "2026-11-10T12:00:00.000Z", updatedBy: "Casey" } as unknown as DBItem,
      { _id: "custom-beta", name: "Beta", type: "free", createdAt: "2026-11-01T12:00:00.000Z", updatedAt: "2026-11-17T12:00:00.000Z", updatedBy: "Dana" } as unknown as DBItem,
    ];
    const store = createControllerLibraryStore(documents, []);

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={createMockControllerContext() as any}>
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <PresentationControllerModeProvider>
              <MemoryRouter initialEntries={["/controller"]}>
                <ItemLibrary />
              </MemoryRouter>
            </PresentationControllerModeProvider>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    expect(await screen.findByText("Casey")).toBeInTheDocument();
    expect(screen.getByText("Dana")).toBeInTheDocument();
    expect(screen.getAllByText("Updated", { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Sort by Updated" })).toBeInTheDocument();
    expect(screen.queryByText(/Created:/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Alpha");

    await user.click(screen.getByRole("button", { name: "Sort by Updated" }));

    await waitFor(() => {
      expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Alpha");
    });
    await user.click(screen.getByRole("button", { name: "Updated, sorted ascending" }));
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Beta");
    });
  });

  it("selects all matching item types, removes successful items from the active outline, and retains V2 failures", async () => {
    const user = userEvent.setup();
    const songProjection = {
      _id: "song-1", name: "Song", type: "song", docType: "song-v2-root",
      songId: "song-1", arrangementIds: [], selectedArrangement: 0, arrangements: [],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z", updatedBy: "Alex",
    } as unknown as DBItem;
    const songRoot = {
      _id: "song-v2:root:song-1", name: "Song", type: "song", docType: "song-v2-root",
      songId: "song-1", arrangementIds: [], selectedArrangement: 0,
    } as unknown as DBItem;
    const custom = {
      _id: "custom-1", name: "Custom", type: "free", slides: [],
      selectedArrangement: 0, arrangements: [], shouldSendTo: { projector: true, monitor: true, stream: true },
      createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-02-02T00:00:00.000Z", updatedBy: "Alex",
    } as unknown as DBItem;
    const timer = {
      _id: "timer-1", name: "Timer", type: "timer", slides: [],
      selectedArrangement: 0, arrangements: [], shouldSendTo: { projector: true, monitor: true, stream: true },
      timerInfo: { id: "timer-1", name: "Timer", hostId: "host-1", duration: 60, countdownTime: "01:00", timerType: "timer", status: "stopped", remainingTime: 60 } as any,
    } as unknown as DBItem;
    const documents = [songProjection, custom, timer];
    const database = createItemDatabase([songRoot, custom, timer]);
    const outline: ServiceItem[] = [
      { _id: "song-1", name: "Song", type: "song", listId: "song-a" },
      { _id: "song-1", name: "Song", type: "song", listId: "song-b" },
      { _id: "custom-1", name: "Custom", type: "free", listId: "custom-row" },
      { _id: "custom-1", name: "Custom", type: "free", listId: "custom-row-duplicate" },
      { _id: "timer-1", name: "Timer", type: "timer", listId: "timer-row" },
    ];
    const store = createControllerLibraryStore(documents, outline);
    store.dispatch(syncTimers([timer.timerInfo] as any));
    window.localStorage.setItem("worshipsync_presentation_controller_mode", "edit");
    window.localStorage.setItem("timerInfo", JSON.stringify([{ id: "timer-1" }]));
    globalFireDbInfo.db = undefined;
    globalFireDbInfo.churchId = "";

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={createMockControllerContext({ db: database.db }) as any}>
          <GlobalInfoContext.Provider value={createMockGlobalContext({ churchId: "church-1", userId: "operator-a" }) as any}>
            <PresentationControllerModeProvider>
              <MemoryRouter initialEntries={["/controller"]}>
                <ItemLibrary />
              </MemoryRouter>
            </PresentationControllerModeProvider>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await screen.findByTitle("Song");
    await user.click(screen.getByRole("button", { name: "Select items" }));
    await user.click(screen.getByRole("checkbox", { name: "Select all results" }));
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete selected" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete selected items" });
    expect(within(dialog).getByText(/3 selected items/)).toBeInTheDocument();
    expect(within(dialog).getByText(/removed from the open outline/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete selected" }));

    expect(await screen.findByText(/Deleted 2 of 3 items/)).toBeInTheDocument();
    expect(await screen.findByText(/uses the V2 format/)).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(database.remove.mock.calls.map(([document]) => document._id).sort()).toEqual(["custom-1", "timer-1"]);
    expect(store.getState().undoable.present.itemList.list.map((row) => row._id)).toEqual(["song-1", "song-1"]);
    expect(store.getState().undoable.past).toHaveLength(0);
    expect(store.getState().timers.timers).toHaveLength(0);
    expect(JSON.parse(window.localStorage.getItem("timerInfo") || "[]")).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    const retryDialog = await screen.findByRole("dialog", { name: "Delete selected items" });
    expect(within(retryDialog).getByText(/1 selected item/)).toBeInTheDocument();
    await user.click(within(retryDialog).getByRole("button", { name: "Delete selected" }));
    expect(await screen.findByText(/No items were deleted/)).toBeInTheDocument();
    expect(database.remove).toHaveBeenCalledTimes(2);
  });

  it("does not report success or remove outline rows when permission changes during a pending delete", async () => {
    const user = userEvent.setup();
    const custom = {
      _id: "custom-pending", name: "Pending Custom", type: "free", slides: [],
      selectedArrangement: 0, arrangements: [], shouldSendTo: { projector: true, monitor: true, stream: true },
    } as unknown as DBItem;
    const outline: ServiceItem[] = [{ _id: custom._id, name: custom.name, type: "free", listId: "pending-row" }];
    const store = createControllerLibraryStore([custom], outline);
    let finishRemove!: () => void;
    const database = {
      get: jest.fn().mockResolvedValue(custom),
      remove: jest.fn(() => new Promise((resolve) => {
        finishRemove = () => resolve({ ok: true });
      })),
    } as any;
    window.localStorage.setItem("worshipsync_presentation_controller_mode", "edit");
    const controllerContext = createMockControllerContext({ db: database });
    const editableGlobalContext = createMockGlobalContext({ churchId: "church-1", userId: "operator-a", access: "full" });
    const viewOnlyGlobalContext = createMockGlobalContext({ churchId: "church-1", userId: "operator-a", access: "view" });
    const view = (globalContext: ReturnType<typeof createMockGlobalContext>) => (
      <Provider store={store}>
        <ControllerInfoContext.Provider value={controllerContext as any}>
          <GlobalInfoContext.Provider value={globalContext as any}>
            <PresentationControllerModeProvider>
              <MemoryRouter initialEntries={["/controller"]}>
                <ItemLibrary />
              </MemoryRouter>
            </PresentationControllerModeProvider>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>
    );
    const utils = render(view(editableGlobalContext));

    await screen.findByTitle("Pending Custom");
    await user.click(screen.getByRole("button", { name: "Select items" }));
    await user.click(screen.getByRole("checkbox", { name: "Select all results" }));
    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete selected items" });
    await user.click(within(dialog).getByRole("button", { name: "Delete selected" }));
    await waitFor(() => expect(database.remove).toHaveBeenCalledTimes(1));

    utils.rerender(view(viewOnlyGlobalContext));
    expect(screen.queryByRole("button", { name: "Select items" })).not.toBeInTheDocument();
    finishRemove();

    expect(await screen.findByText(/session or permission changed/)).toBeInTheDocument();
    expect(screen.getByText("Pending Custom")).toBeInTheDocument();
    expect(screen.queryByText("Deleted 1 item.")).not.toBeInTheDocument();
    expect(store.getState().undoable.present.itemList.list).toEqual(outline);
    expect(await screen.findByRole("button", { name: "Retry cleanup for Pending Custom" })).toBeDisabled();
  });
});
