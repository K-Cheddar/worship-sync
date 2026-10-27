import allDocsReducer, { hydrateItemCache } from "../../store/allDocsSlice";
import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { Provider, useDispatch } from "react-redux";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import Item from "./Item";
import { itemSlice } from "../../store/itemSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { SERVICE_TIME_COUNTDOWN_ID } from "../../constants/nextServiceTimer";
import {
  createMockControllerContext,
  createMockGlobalContext,
  createMockPouchDB,
} from "../../test/mocks";
import type { DBItem } from "../../types";

jest.mock("../../containers/ItemEditor/SlideEditor", () => () => (
  <div data-testid="slide-editor" />
));

jest.mock("../../containers/ItemSlides/ItemSlides", () => () => (
  <div data-testid="item-slides" />
));

const itemRoute = (itemId: string, listId: string) =>
  `/controller/item/${window.btoa(encodeURI(itemId))}/${window.btoa(
    encodeURI(listId),
  )}`;

const RouteDriver = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  return (
    <>
      <button type="button" onClick={() => navigate(itemRoute("item-c", "list-c"))}>
        Go to C
      </button>
      <button type="button" onClick={() => navigate(itemRoute("item-d", "list-d"))}>
        Go to D
      </button>
      <button
        type="button"
        onClick={() => {
          dispatch(itemSlice.actions.setActiveItem({
            _id: "item-c",
            name: "C current",
            type: "free",
            slides: [],
            formattedSections: [],
            background: "current background",
            listId: "list-c",
          }));
          navigate(itemRoute("item-c", "list-c"));
        }}
      >
        Continue to C
      </button>
    </>
  );
};

const createTestStore = () => {
  const initialUndoableState = {
    past: [],
    present: {
      item: itemSlice.getInitialState(),
    },
    future: [],
  };

  const undoableReducer = (state = initialUndoableState, action: any) => ({
    ...state,
    present: {
      ...state.present,
      item: itemSlice.reducer(state.present.item, action),
    },
  });

  return configureStore({
    reducer: {
      undoable: undoableReducer,
      allDocs: allDocsReducer,
    },
    preloadedState: {
      undoable: initialUndoableState,
    },
  });
};

describe("Controller Item page", () => {
  it("navigates between cached items without PouchDB reads or loading transitions", async () => {
    const dbAllDocs = jest.fn();
    const dbChanges = jest.fn();
    const store = createTestStore();
    store.dispatch(hydrateItemCache([
      { _id: "item-b", name: "B", type: "song" as const, arrangements: [], slides: [] },
      { _id: "item-c", name: "C current", type: "free" as const, background: "current background", slides: [] },
      {
        _id: "item-d",
        name: "D current",
        type: "song" as const,
        selectedArrangement: 1,
        arrangements: [
          {
            id: "arr-0",
            name: "First",
            formattedLyrics: [],
            songOrder: [],
            slides: [{ id: "d-first", name: "First slide", type: "Verse" as const, boxes: [] }],
          },
          {
            id: "arr-1",
            name: "Selected",
            formattedLyrics: [],
            songOrder: [],
            slides: [{ id: "d-selected", name: "Selected slide", type: "Verse" as const, boxes: [] }],
          },
        ],
        slides: [{ id: "d-selected", name: "Selected slide", type: "Verse" as const, boxes: [] }],
      },
    ].map((doc) => ({ ...itemSlice.getInitialState(), ...doc }))));
    const observedLoadingStates: boolean[] = [];
    const unsubscribe = store.subscribe(() => {
      observedLoadingStates.push(Boolean(store.getState().undoable.present.item.isLoading));
    });
    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={createMockControllerContext({ db: createMockPouchDB({ allDocs: dbAllDocs, changes: dbChanges }) }) as any}>
          <MemoryRouter initialEntries={[itemRoute("item-b", "list-b")]}>
            <Routes><Route path="/controller/item/:itemId/:listId" element={<><RouteDriver /><Item /></>} /></Routes>
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>,
    );
    await waitFor(() => expect(store.getState().undoable.present.item._id).toBe("item-b"));
    const slidesBeforeNavigation = screen.getByTestId("item-slides");
    fireEvent.click(screen.getByRole("button", { name: "Go to C" }));
    await waitFor(() => expect(store.getState().undoable.present.item._id).toBe("item-c"));
    expect(store.getState().undoable.present.item).toMatchObject({ name: "C current", background: "current background", listId: "list-c" });
    expect(screen.getByTestId("item-slides")).toBe(slidesBeforeNavigation);
    fireEvent.click(screen.getByRole("button", { name: "Go to D" }));
    await waitFor(() => expect(store.getState().undoable.present.item._id).toBe("item-d"));
    expect(store.getState().undoable.present.item).toMatchObject({
      name: "D current",
      listId: "list-d",
      selectedArrangement: 1,
      slides: [expect.objectContaining({ id: "d-selected" })],
    });
    expect(dbAllDocs).not.toHaveBeenCalled();
    expect(dbChanges).not.toHaveBeenCalled();
    expect(observedLoadingStates).not.toContain(true);
    expect(screen.getByTestId("item-slides")).toBe(slidesBeforeNavigation);

    fireEvent.click(screen.getByRole("button", { name: "Go to C" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to D" }));
    await waitFor(() => expect(store.getState().undoable.present.item._id).toBe("item-d"));
    expect(store.getState().undoable.present.item).toMatchObject({
      name: "D current",
      listId: "list-d",
      selectedArrangement: 1,
    });
    expect(observedLoadingStates).not.toContain(true);
    unsubscribe();
  });

  it("keeps continuous-scroll activation mounted without reading PouchDB", async () => {
    const dbAllDocs = jest.fn();
    const dbChanges = jest.fn();
    const store = createTestStore();
    store.dispatch(hydrateItemCache([
      { _id: "item-b", name: "B", type: "song" as const, arrangements: [], slides: [] },
      { _id: "item-c", name: "C current", type: "free" as const, slides: [] },
    ].map((doc) => ({ ...itemSlice.getInitialState(), ...doc }))));
    const observedLoadingStates: boolean[] = [];
    const unsubscribe = store.subscribe(() => {
      observedLoadingStates.push(Boolean(store.getState().undoable.present.item.isLoading));
    });
    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={createMockControllerContext({ db: createMockPouchDB({ allDocs: dbAllDocs, changes: dbChanges }) }) as any}>
          <MemoryRouter initialEntries={[itemRoute("item-b", "list-b")] }>
            <Routes><Route path="/controller/item/:itemId/:listId" element={<><RouteDriver /><Item /></>} /></Routes>
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>,
    );
    await waitFor(() => expect(store.getState().undoable.present.item._id).toBe("item-b"));
    const slidesBeforeNavigation = screen.getByTestId("item-slides");

    fireEvent.click(screen.getByRole("button", { name: "Continue to C" }));

    await waitFor(() => expect(store.getState().undoable.present.item).toMatchObject({ _id: "item-c", listId: "list-c" }));
    expect(screen.getByTestId("item-slides")).toBe(slidesBeforeNavigation);
    expect(observedLoadingStates).not.toContain(true);
    expect(dbAllDocs).not.toHaveBeenCalled();
    expect(dbChanges).not.toHaveBeenCalled();
    unsubscribe();
  });

  it.each(["edit", "delete"] as const)("discards a stale fallback read when a live %s arrives", async (change) => {
    let finish!: (value: { update_seq: number; rows: Array<{ doc: DBItem }> }) => void;
    const pending = new Promise<{ update_seq: number; rows: Array<{ doc: DBItem }> }>((resolve) => { finish = resolve; });
    const read = jest.fn().mockReturnValue(pending);
    const store = createTestStore();
    const doc = { ...itemSlice.getInitialState(), _id: "item-b", name: "Old", type: "song" as const };
    const changes = jest.fn().mockResolvedValue({ results: [change === "edit"
      ? { id: "item-b", doc: { ...doc, name: "Newer" } }
      : { id: "item-b", deleted: true, doc: { ...doc, _deleted: true } },
    ] });
    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={createMockControllerContext({ db: createMockPouchDB({ allDocs: read, changes }) }) as any}>
          <MemoryRouter initialEntries={[itemRoute("item-b", "list-b")]}>
            <Routes><Route path="/controller/item/:itemId/:listId" element={<Item />} /></Routes>
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>,
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await act(async () => { finish({ update_seq: 0, rows: [{ doc }] }); await pending; });
    await waitFor(() => expect(store.getState().undoable.present.item._id).toBe(change === "edit" ? "item-b" : itemSlice.getInitialState()._id));
    expect(store.getState().undoable.present.item.name).toBe(change === "edit" ? "Newer" : itemSlice.getInitialState().name);
    expect(read).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledWith(expect.objectContaining({ doc_ids: ["item-b"], include_docs: true }));
    await waitFor(() => expect(Boolean(screen.queryByText("Item Not Found"))).toBe(change === "delete"));
  });

  it("clears loading when fetching the item fails", async () => {
    const dbAllDocs = jest.fn().mockRejectedValue(new Error("load failed"));
    const controllerContext = createMockControllerContext({
      db: createMockPouchDB({ allDocs: dbAllDocs }),
    });
    const globalContext = createMockGlobalContext();
    const store = createTestStore();
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => { });

    const itemId = window.btoa(encodeURI("item-123"));
    const listId = window.btoa(encodeURI("list-456"));

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={controllerContext as any}>
          <GlobalInfoContext.Provider value={globalContext as any}>
            <MemoryRouter initialEntries={[`/controller/item/${itemId}/${listId}`]}>
              <Routes>
                <Route
                  path="/controller/item/:itemId/:listId"
                  element={<Item />}
                />
              </Routes>
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    expect(await screen.findByText("Item Not Found")).toBeInTheDocument();

    expect(dbAllDocs).toHaveBeenCalledWith({ keys: ["item-123"], include_docs: true, update_seq: true });
    expect(store.getState().undoable.present.item.isLoading).toBe(false);

    consoleErrorSpy.mockRestore();
  });

  it("creates the generated service-time item when its validated cache miss is empty", async () => {
    const dbAllDocs = jest.fn().mockResolvedValue({ update_seq: 0, rows: [] });
    const dbChanges = jest.fn().mockResolvedValue({ results: [] });
    const dbPut = jest.fn().mockResolvedValue({ ok: true });
    const controllerContext = createMockControllerContext({
      db: createMockPouchDB({ allDocs: dbAllDocs, changes: dbChanges, put: dbPut }),
    });
    const store = createTestStore();
    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={controllerContext as any}>
          <MemoryRouter initialEntries={[itemRoute(SERVICE_TIME_COUNTDOWN_ID, "list-service-time")] }>
            <Routes><Route path="/controller/item/:itemId/:listId" element={<Item />} /></Routes>
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(store.getState().undoable.present.item._id).toBe(SERVICE_TIME_COUNTDOWN_ID));
    expect(dbAllDocs).toHaveBeenCalledTimes(1);
    expect(dbChanges).toHaveBeenCalledTimes(1);
    expect(dbPut).toHaveBeenCalledTimes(1);
  });

  it("backfills formatted sections for free items missing them", async () => {
    const item = {
      _id: "item-123",
      name: "Free item",
      type: "free",
      slides: [
        {
          name: "Section 1",
          boxes: [
            { words: "ignored" },
            { words: "Line one" },
          ],
        },
        {
          name: "Section 1",
          boxes: [
            { words: "ignored" },
            { words: "Line two" },
          ],
        },
      ],
      formattedSections: [],
    } as unknown as DBItem;
    const dbAllDocs = jest.fn().mockResolvedValue({ update_seq: 0, rows: [{ doc: item }] });
    const controllerContext = createMockControllerContext({
      db: createMockPouchDB({ allDocs: dbAllDocs, changes: jest.fn().mockResolvedValue({ results: [] }) }),
    });
    const globalContext = createMockGlobalContext();
    const store = createTestStore();
    const itemId = window.btoa(encodeURI("item-123"));
    const listId = window.btoa(encodeURI("list-456"));

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={controllerContext as any}>
          <GlobalInfoContext.Provider value={globalContext as any}>
            <MemoryRouter initialEntries={[`/controller/item/${itemId}/${listId}`]}>
              <Routes>
                <Route
                  path="/controller/item/:itemId/:listId"
                  element={<Item />}
                />
              </Routes>
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => {
      expect(store.getState().undoable.present.item.isLoading).toBe(false);
    });

    const { formattedSections } = store.getState().undoable.present.item;
    expect(formattedSections).toHaveLength(1);
    expect(formattedSections?.[0]).toEqual(
      expect.objectContaining({
        sectionNum: 1,
        words: "Line one\nLine two",
        slideSpan: 2,
      }),
    );
  });

  it("skips re-fetch when Redux already has the route item loaded", async () => {
    const dbAllDocs = jest.fn().mockResolvedValue({
      update_seq: 0,
      rows: [{ doc: {
      _id: "item-123",
      name: "Should not load",
      type: "song",
      slides: [],
      arrangements: [],
      selectedArrangement: 0,
      } }],
    });
    const dbChanges = jest.fn();
    const controllerContext = createMockControllerContext({
      db: createMockPouchDB({ allDocs: dbAllDocs, changes: dbChanges }),
    });
    const globalContext = createMockGlobalContext();
    const store = createTestStore();
    store.dispatch(
      itemSlice.actions.setActiveItem({
        _id: "item-123",
        listId: "list-456",
        name: "Already loaded",
        type: "song",
        slides: [],
        arrangements: [],
        selectedArrangement: 0,
      } as any),
    );

    const itemId = window.btoa(encodeURI("item-123"));
    const listId = window.btoa(encodeURI("list-456"));

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={controllerContext as any}>
          <GlobalInfoContext.Provider value={globalContext as any}>
            <MemoryRouter initialEntries={[`/controller/item/${itemId}/${listId}`]}>
              <Routes>
                <Route
                  path="/controller/item/:itemId/:listId"
                  element={<Item />}
                />
              </Routes>
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    expect(await screen.findByTestId("item-slides")).toBeInTheDocument();
    expect(dbAllDocs).not.toHaveBeenCalled();
    expect(dbChanges).not.toHaveBeenCalled();
    expect(store.getState().undoable.present.item.isLoading).toBe(false);
    expect(store.getState().undoable.present.item.name).toBe("Already loaded");
  });

  it("does not commit an older item load after navigation moves to a newer item", async () => {
    let resolveB: ((snapshot: { update_seq: number; rows: Array<{ doc: DBItem }> }) => void) | undefined;
    let resolveC: ((snapshot: { update_seq: number; rows: Array<{ doc: DBItem }> }) => void) | undefined;
    const dbAllDocs = jest.fn(({ keys }: { keys: string[] }) => {
      if (keys[0] === "item-b") {
        return new Promise<{ update_seq: number; rows: Array<{ doc: DBItem }> }>((resolve) => {
          resolveB = resolve;
        });
      }
      if (keys[0] === "item-c") {
        return new Promise<{ update_seq: number; rows: Array<{ doc: DBItem }> }>((resolve) => {
          resolveC = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected item ${keys[0]}`));
    });
    const dbChanges = jest.fn().mockResolvedValue({ results: [] });
    const controllerContext = createMockControllerContext({
      db: createMockPouchDB({ allDocs: dbAllDocs, changes: dbChanges }),
    });
    const globalContext = createMockGlobalContext();
    const store = createTestStore();
    const itemB = {
      _id: "item-b",
      name: "Item B",
      type: "song",
      slides: [],
      arrangements: [],
      selectedArrangement: 0,
    } as unknown as DBItem;
    const itemC = {
      _id: "item-c",
      name: "Item C",
      type: "song",
      slides: [],
      arrangements: [],
      selectedArrangement: 0,
    } as unknown as DBItem;

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={controllerContext as any}>
          <GlobalInfoContext.Provider value={globalContext as any}>
            <MemoryRouter initialEntries={[itemRoute("item-b", "list-b")]}>
              <Routes>
                <Route
                  path="/controller/item/:itemId/:listId"
                  element={
                    <>
                      <RouteDriver />
                      <Item />
                    </>
                  }
                />
              </Routes>
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => expect(dbAllDocs).toHaveBeenCalledWith({ keys: ["item-b"], include_docs: true, update_seq: true }));
    fireEvent.click(screen.getByRole("button", { name: "Go to C" }));
    await waitFor(() => expect(dbAllDocs).toHaveBeenCalledWith({ keys: ["item-c"], include_docs: true, update_seq: true }));

    await act(async () => {
      resolveB?.({ update_seq: 0, rows: [{ doc: itemB }] });
      await Promise.resolve();
    });
    expect(store.getState().undoable.present.item._id).not.toBe("item-b");

    await act(async () => {
      resolveC?.({ update_seq: 0, rows: [{ doc: itemC }] });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(store.getState().undoable.present.item._id).toBe("item-c"),
    );
    expect(store.getState().undoable.present.item.listId).toBe("list-c");
  });
});
