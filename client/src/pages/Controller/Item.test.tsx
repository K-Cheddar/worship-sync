import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Item from "./Item";
import { itemSlice } from "../../store/itemSlice";
import allDocsReducer from "../../store/allDocsSlice";
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

const createTestStore = (
  allDocs?: Partial<{
    allSongDocs: DBItem[];
    allFreeFormDocs: DBItem[];
    allTimerDocs: DBItem[];
    allBibleDocs: DBItem[];
  }>,
) => {
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
      allDocs: {
        allSongDocs: allDocs?.allSongDocs ?? [],
        allFreeFormDocs: allDocs?.allFreeFormDocs ?? [],
        allTimerDocs: allDocs?.allTimerDocs ?? [],
        allBibleDocs: allDocs?.allBibleDocs ?? [],
      },
    },
  });
};

describe("Controller Item page", () => {
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
    expect(formattedSections[0]).toEqual(
      expect.objectContaining({
        sectionNum: 1,
        words: "Line one\nLine two",
        slideSpan: 2,
      }),
    );
  });

  it("activates a cached allDocs item without a loading fetch", async () => {
    const dbGet = jest.fn();
    const controllerContext = createMockControllerContext({
      db: createMockPouchDB({ get: dbGet }),
    });
    const globalContext = createMockGlobalContext();
    const cachedItem = {
      _id: "item-123",
      name: "Cached song",
      type: "song",
      selectedArrangement: 0,
      arrangements: [],
      slides: [{ id: "s1", name: "Verse 1", type: "Verse", boxes: [] }],
      shouldSendTo: { projector: true, monitor: true, stream: true },
    } as unknown as DBItem;
    const store = createTestStore({ allSongDocs: [cachedItem] });
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
      expect(store.getState().undoable.present.item._id).toBe("item-123");
    });

    expect(dbGet).not.toHaveBeenCalled();
    expect(store.getState().undoable.present.item.isLoading).toBe(false);
    expect(screen.getByTestId("item-slides")).toBeInTheDocument();
  });
});
