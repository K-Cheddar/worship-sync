import ControllerItemInitialization from "./ControllerItemInitialization";
import { setActiveContentDatabase } from "../../store/deferredItemMutations";
import { configureStore, combineReducers } from "@reduxjs/toolkit";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import Item from "./Item";
import allDocs, { hydrateItemCache } from "../../store/allDocsSlice";
import { itemSlice } from "../../store/itemSlice";
import { itemListSlice } from "../../store/itemListSlice";
import { selectControllerItem } from "../../store/controllerItemSelection";
import type { AppDispatch, RootState } from "../../store/store";
import type { DBItem } from "../../types";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { createMockControllerContext, createMockPouchDB } from "../../test/mocks";
import { SERVICE_TIME_COUNTDOWN_ID } from "../../constants/nextServiceTimer";
import { buildServiceTimeItem } from "../../utils/itemUtil";

jest.mock("../../containers/ItemEditor/SlideEditor", () => () => <div data-testid="slide-editor" />);
jest.mock("../../containers/ItemSlides/ItemSlides", () => () => <div data-testid="item-slides" />);

const doc = (id: string, overrides: Partial<DBItem> = {}): DBItem => ({
  ...itemSlice.getInitialState(), _id: id, name: id, type: "free", ...overrides,
});
const row = (_id: string, listId = _id) => ({ _id, listId, name: _id, type: "free" });
const present = combineReducers({ item: itemSlice.reducer, itemList: itemListSlice.reducer });
const makeStore = () => {
  const reducer = combineReducers({
    allDocs,
    undoable: (state: { present: ReturnType<typeof present> } | undefined, action: Parameters<typeof present>[1]) => ({ present: present(state?.present, action) }),
  });
  return configureStore({ reducer: (state: ReturnType<typeof reducer> | undefined, action: Parameters<typeof reducer>[1]) => reducer(action.type === "RESET" ? undefined : state, action) });
};
const Workspace = () => <><ControllerItemInitialization /><Item /></>;
const Location = () => <span data-testid="location">{useLocation().pathname}</span>;
const setup = (path = "/controller") => {
  const store = makeStore();
  const db = createMockPouchDB({
    allDocs: jest.fn().mockResolvedValue({ rows: [], update_seq: 1 }),
    changes: jest.fn().mockResolvedValue({ results: [] }),
    put: jest.fn().mockResolvedValue({ ok: true }),
  });
  const select = (id: string, listId = id, slide?: number) => (store.dispatch as AppDispatch)(selectControllerItem(row(id, listId), db, slide));
  const mount = () => render(<Provider store={store}>
    <ControllerInfoContext.Provider value={createMockControllerContext({ db })}>
      <MemoryRouter initialEntries={[path]}><Location /><Routes><Route path={path} element={<Workspace />} /></Routes></MemoryRouter>
    </ControllerInfoContext.Provider>
  </Provider>);
  return { store, db, select, mount };
};

describe("Redux presentation workspace", () => {
  it.each(["/controller", "/aux-controller/lobby"])("activates cached items synchronously without reads, loading or remount at %s", async (path) => {
    const { store, db, select, mount } = setup(path);
    store.dispatch(hydrateItemCache([doc("A"), doc("B", { type: "song", selectedArrangement: 1,
      slides: [{ id: "chosen-slide", type: "Verse", name: "Chosen", boxes: [] }],
      arrangements: [
        { id: "first", name: "First", slides: [], formattedLyrics: [], songOrder: [] },
        { id: "chosen", name: "Chosen", slides: [{ id: "chosen-slide", type: "Verse", name: "Chosen", boxes: [] }], formattedLyrics: [], songOrder: [] },
      ],
    })]));
    await select("A");
    mount();
    const editor = screen.getByTestId("slide-editor");
    const grid = screen.getByTestId("item-slides");
    const loading: boolean[] = [];
    store.subscribe(() => loading.push(Boolean(store.getState().undoable.present.item.isLoading)));
    act(() => { void select("B", "B-second"); });
    expect(store.getState().undoable.present.item).toMatchObject({ _id: "B", listId: "B-second", selectedArrangement: 1, slides: [expect.objectContaining({ id: "chosen-slide" })] });
    act(() => { void select("A", "A-second"); });
    expect(store.getState().undoable.present.item).toMatchObject({ _id: "A", listId: "A-second" });
    expect(screen.getByTestId("slide-editor")).toBe(editor);
    expect(screen.getByTestId("item-slides")).toBe(grid);
    expect(screen.getByTestId("location")).toHaveTextContent(path);
    expect(db.allDocs).not.toHaveBeenCalled();
    expect(db.changes).not.toHaveBeenCalled();
    expect(db.get).not.toHaveBeenCalled();
    expect(loading).not.toContain(true);
  });

  it("preserves draft/conflict state when reselecting and switching occurrences of the same document", async () => {
    const { store, select } = setup();
    store.dispatch(hydrateItemCache([doc("A")]));
    await select("A", "first");
    store.dispatch(itemSlice.actions._setName("Unsaved"));
    store.dispatch(itemSlice.actions.bufferRemoteItemUpdate(doc("A", { name: "Remote" })));
    const before = store.getState().undoable.present.item;
    await select("A", "first");
    expect(store.getState().undoable.present.item).toEqual(before);
    await select("A", "second");
    expect(store.getState().undoable.present.item).toMatchObject({ listId: "second", name: "Unsaved", hasPendingUpdate: true, hasRemoteUpdate: true });
  });

  it("waits for initialized outline and cache and restores only the established occurrence", async () => {
    const { store, mount } = setup();
    store.dispatch(itemListSlice.actions.setActiveItemInList("established"));
    mount();
    expect(screen.getByText("No Item Selected")).toBeInTheDocument();
    act(() => { store.dispatch(itemListSlice.actions.initiateItemList([row("other")])); });
    act(() => { store.dispatch(hydrateItemCache([doc("A"), doc("other")])); });
    expect(screen.getByText("No Item Selected")).toBeInTheDocument();
    act(() => { store.dispatch(itemListSlice.actions.updateItemListFromRemote([row("other"), row("A", "established")])); });
    await waitFor(() => expect(store.getState().undoable.present.item).toMatchObject({ _id: "A", listId: "established" }));
    act(() => { store.dispatch({ type: "RESET" }); });
    expect(screen.getByText("No Item Selected")).toBeInTheDocument();
  });

  it("discards a delayed miss after a cached selection and after a church reset", async () => {
    const { store, db, select } = setup();
    let resolve!: (value: unknown) => void;
    (db.allDocs as jest.Mock).mockReturnValue(new Promise((done) => { resolve = done; }));
    store.dispatch(hydrateItemCache([doc("B")]));
    const missing = select("A");
    await select("B");
    resolve({ rows: [{ doc: doc("A") }], update_seq: 1 });
    await missing;
    expect(store.getState().undoable.present.item._id).toBe("B");
    const oldSession = select("A");
    store.dispatch({ type: "RESET" });
    store.dispatch(hydrateItemCache([doc("A", { name: "New church" })]));
    await select("A");
    resolve({ rows: [{ doc: doc("A", { name: "Old church" }) }], update_seq: 1 });
    await oldSession;
    expect(store.getState().undoable.present.item.name).toBe("New church");
  });

  it("uses the newest cache data arriving during a miss and prepares free sections", async () => {
    const { store, db, select } = setup();
    let resolve!: (value: unknown) => void;
    (db.allDocs as jest.Mock).mockReturnValue(new Promise((done) => { resolve = done; }));
    const pending = select("A");
    store.dispatch(hydrateItemCache([doc("A", { name: "Newest" })]));
    resolve({ rows: [{ doc: doc("A", { name: "Stale" }) }], update_seq: 1 });
    await pending;
    expect(store.getState().undoable.present.item.name).toBe("Newest");
    expect(store.getState().undoable.present.item.formattedSections).toEqual([]);
  });

  it("selects cached timer and service-time documents without reads", async () => {
    const { store, db, select } = setup();
    store.dispatch(hydrateItemCache([doc("timer", { type: "timer" }), buildServiceTimeItem() as DBItem]));
    await select("timer");
    await select(SERVICE_TIME_COUNTDOWN_ID);
    expect(store.getState().undoable.present.item.type).toBe("service-time");
    expect(db.allDocs).not.toHaveBeenCalled();
  });

  it("creates the service-time item on first access and caches it", async () => {
    const { store, db, select } = setup();
    await select(SERVICE_TIME_COUNTDOWN_ID);
    expect(store.getState().undoable.present.item.type).toBe("service-time");
    expect(db.put).toHaveBeenCalled();
    expect((store.getState() as RootState).allDocs.allServiceTimeDocs).toHaveLength(1);
  });
  it("shows Item Not Found on a miss and recovers through a cached selection", async () => {
    const { store, select, mount } = setup();
    store.dispatch(hydrateItemCache([doc("B")]));
    await select("B");
    mount();
    await act(async () => { await select("missing"); });
    expect(screen.getByText("Item Not Found")).toBeInTheDocument();
    act(() => { void select("B"); });
    expect(screen.getByTestId("item-slides")).toBeInTheDocument();
  });

  it("independent controller stores can select and edit separate items", async () => {
    const main = setup();
    const aux = setup("/aux-controller/lobby");
    main.store.dispatch(hydrateItemCache([doc("A"), doc("B")]));
    aux.store.dispatch(hydrateItemCache([doc("A"), doc("B")]));
    await main.select("A");
    await aux.select("B");
    main.store.dispatch(itemSlice.actions._setName("Main draft"));
    aux.store.dispatch(itemSlice.actions._setName("Aux draft"));
    expect(main.store.getState().undoable.present.item).toMatchObject({ _id: "A", name: "Main draft" });
    expect(aux.store.getState().undoable.present.item).toMatchObject({ _id: "B", name: "Aux draft" });
  });

  it("rejects an old database response even when cache session and occurrence IDs have not reset yet", async () => {
    const { store, db, select } = setup();
    let resolve!: (value: unknown) => void;
    (db.allDocs as jest.Mock).mockReturnValue(new Promise((done) => { resolve = done; }));
    const oldOwner = { scopeId: "old-db", databaseKey: "old", churchId: "old-church" };
    setActiveContentDatabase(oldOwner, db);
    const pending = select("A");
    setActiveContentDatabase({ scopeId: "new-db", databaseKey: "new", churchId: "new-church" });
    resolve({ rows: [{ doc: doc("A", { name: "Old database" }) }], update_seq: 1 });
    await pending;
    expect(store.getState().undoable.present.item.type).toBe("");
    setActiveContentDatabase(null);
  });

});
