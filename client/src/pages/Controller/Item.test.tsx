import allDocsReducer, { hydrateItemCache, applyItemDocumentChange } from "../../store/allDocsSlice";
import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import Item from "./Item";
import { itemSlice } from "../../store/itemSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
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
  return (
    <button type="button" onClick={() => navigate(itemRoute("item-c", "list-c"))}>
      Go to C
    </button>
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
  it("navigates between loaded items without additional PouchDB reads", async () => {
    const dbGet = jest.fn();
    const store = createTestStore();
    store.dispatch(hydrateItemCache([
      { _id: "item-b", name: "B", type: "song" as const, arrangements: [], slides: [] },
      { _id: "item-c", name: "C current", type: "free" as const, background: "current background", slides: [] },
    ].map((doc) => ({ ...itemSlice.getInitialState(), ...doc }))));
    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={createMockControllerContext({ db: createMockPouchDB({ get: dbGet }) }) as any}>
          <MemoryRouter initialEntries={[itemRoute("item-b", "list-b")]}>
            <Routes><Route path="/controller/item/:itemId/:listId" element={<><RouteDriver /><Item /></>} /></Routes>
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>,
    );
    await waitFor(() => expect(store.getState().undoable.present.item._id).toBe("item-b"));
    fireEvent.click(screen.getByRole("button", { name: "Go to C" }));
    await waitFor(() => expect(store.getState().undoable.present.item._id).toBe("item-c"));
    expect(store.getState().undoable.present.item).toMatchObject({ name: "C current", background: "current background", listId: "list-c" });
    expect(dbGet).not.toHaveBeenCalled();
  });

  it.each(["edit", "delete"] as const)("discards a stale fallback read when a live %s arrives", async (change) => {
    let finish!: (value: DBItem) => void;
    const pending = new Promise<DBItem>((resolve) => { finish = resolve; });
    const read = jest.fn().mockReturnValueOnce(pending).mockRejectedValue({ status: 404 });
    const store = createTestStore();
    const doc = { ...itemSlice.getInitialState(), _id: "item-b", name: "Old", type: "song" as const };
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={createMockControllerContext({ db: createMockPouchDB({ get: read }) }) as any}>
          <MemoryRouter initialEntries={[itemRoute("item-b", "list-b")]}>
            <Routes><Route path="/controller/item/:itemId/:listId" element={<Item />} /></Routes>
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>,
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    act(() => { store.dispatch(applyItemDocumentChange(change === "edit"
      ? { id: "item-b", doc: { ...doc, name: "Newer" } }
      : { id: "item-b", deleted: true })); });
    await act(async () => { finish(doc); await pending; });
    await waitFor(() => expect(store.getState().undoable.present.item._id).toBe(change === "edit" ? "item-b" : itemSlice.getInitialState()._id));
    expect(store.getState().undoable.present.item.name).toBe(change === "edit" ? "Newer" : itemSlice.getInitialState().name);
    expect(read).toHaveBeenCalledTimes(change === "edit" ? 1 : 2);
    await waitFor(() => expect(Boolean(screen.queryByText("Item Not Found"))).toBe(change === "delete"));
    expect(store.getState().allDocs.allSongDocs.map((item) => item.name)).toEqual(change === "edit" ? ["Newer"] : []);
    log.mockRestore();
  });

  it("clears loading when fetching the item fails", async () => {
    const dbGet = jest.fn().mockRejectedValue(new Error("load failed"));
    const controllerContext = createMockControllerContext({
      db: createMockPouchDB({ get: dbGet }),
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

    expect(dbGet).toHaveBeenCalledWith("item-123");
    expect(store.getState().undoable.present.item.isLoading).toBe(false);

    consoleErrorSpy.mockRestore();
  });

  it("backfills formatted sections for free items missing them", async () => {
    const dbGet = jest.fn().mockResolvedValue({
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
    } as unknown as DBItem);
    const controllerContext = createMockControllerContext({
      db: createMockPouchDB({ get: dbGet }),
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
    const dbGet = jest.fn().mockResolvedValue({
      _id: "item-123",
      name: "Should not load",
      type: "song",
      slides: [],
      arrangements: [],
      selectedArrangement: 0,
    } as unknown as DBItem);
    const controllerContext = createMockControllerContext({
      db: createMockPouchDB({ get: dbGet }),
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
    expect(dbGet).not.toHaveBeenCalled();
    expect(store.getState().undoable.present.item.isLoading).toBe(false);
    expect(store.getState().undoable.present.item.name).toBe("Already loaded");
  });

  it("does not commit an older item load after navigation moves to a newer item", async () => {
    let resolveB: ((item: DBItem) => void) | undefined;
    let resolveC: ((item: DBItem) => void) | undefined;
    const dbGet = jest.fn((id: string) => {
      if (id === "item-b") {
        return new Promise<DBItem>((resolve) => {
          resolveB = resolve;
        });
      }
      if (id === "item-c") {
        return new Promise<DBItem>((resolve) => {
          resolveC = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected item ${id}`));
    });
    const controllerContext = createMockControllerContext({
      db: createMockPouchDB({ get: dbGet }),
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

    await waitFor(() => expect(dbGet).toHaveBeenCalledWith("item-b"));
    fireEvent.click(screen.getByRole("button", { name: "Go to C" }));
    await waitFor(() => expect(dbGet).toHaveBeenCalledWith("item-c"));

    await act(async () => {
      resolveB?.(itemB);
      await Promise.resolve();
    });
    expect(store.getState().undoable.present.item._id).not.toBe("item-b");

    await act(async () => {
      resolveC?.(itemC);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(store.getState().undoable.present.item._id).toBe("item-c"),
    );
    expect(store.getState().undoable.present.item.listId).toBe("list-c");
  });
});
