import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import Bible from "./Bible";
import {
  createItemSlice,
  initialCreateItemState,
} from "../../store/createItemSlice";
import { bibleSlice } from "../../store/bibleSlice";
import { presentationSlice } from "../../store/presentationSlice";
import { allItemsSlice } from "../../store/allItemsSlice";
import { itemListSlice } from "../../store/itemListSlice";
import { itemSlice } from "../../store/itemSlice";
import { preferencesSlice } from "../../store/preferencesSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { createMockControllerContext } from "../../test/mocks";
import type { ItemState } from "../../types";
import { createNewBible } from "../../utils/itemUtil";

jest.mock("../../utils/itemUtil", () => {
  const actual = jest.requireActual("../../utils/itemUtil");
  return {
    ...actual,
    createNewBible: jest.fn(),
  };
});

const mockedCreateNewBible = createNewBible as jest.MockedFunction<
  typeof createNewBible
>;

const createMockItem = (overrides: Partial<ItemState> = {}): ItemState => ({
  name: "Created Bible",
  _id: "bible-1",
  type: "bible",
  selectedArrangement: 0,
  arrangements: [],
  slides: [],
  shouldSendTo: {
    projector: true,
    monitor: true,
    stream: true,
  },
  selectedSlide: 0,
  selectedBox: 0,
  ...overrides,
});

const createUndoableState = () => ({
  past: [],
  present: {
    preferences: preferencesSlice.getInitialState(),
  },
  future: [],
});

const createBibleStore = () => {
  const undoableState = createUndoableState();
  const verses = [{ name: "1", index: 0, text: "For God so loved the world" }];
  const chapters = [{ name: "3", index: 0, verses }];
  const books = [{ name: "John", index: 0, chapters }];

  return configureStore({
    reducer: {
      createItem: createItemSlice.reducer,
      bible: bibleSlice.reducer,
      presentation: presentationSlice.reducer,
      allItems: allItemsSlice.reducer,
      itemList: itemListSlice.reducer,
      item: itemSlice.reducer,
      undoable: (state = undoableState) => state,
    } as any,
    preloadedState: {
      createItem: {
        name: "John Reading",
        type: "bible",
        text: "Draft text",
        hours: 1,
        minutes: 2,
        seconds: 3,
        time: "09:30",
        timerType: "countdown",
      },
      bible: {
        ...bibleSlice.getInitialState(),
        books,
        chapters,
        verses,
        book: 0,
        chapter: 0,
        startVerse: 0,
        endVerse: 0,
      },
      presentation: presentationSlice.getInitialState(),
      allItems: {
        ...allItemsSlice.getInitialState(),
        list: [],
        isAllItemsLoading: false,
        isInitialized: true,
      },
      itemList: itemListSlice.getInitialState(),
      item: itemSlice.getInitialState(),
      undoable: undoableState,
    } as any,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
        immutableCheck: false,
      }),
  });
};

describe("Bible", () => {
  beforeEach(() => {
    mockedCreateNewBible.mockReset();
  });

  it("clears the create-item draft after a successful Bible add", async () => {
    mockedCreateNewBible.mockResolvedValue(
      createMockItem({
        name: "John 3:1 NKJV",
      })
    );

    const store = createBibleStore();

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext() as any}
        >
          <MemoryRouter initialEntries={["/controller/bible?name=John%20Reading"]}>
            <Bible />
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Add to outline" }));

    await waitFor(() => {
      expect(mockedCreateNewBible).toHaveBeenCalled();
    });

    expect(store.getState().createItem).toEqual(initialCreateItemState);
  });

  it("hydrates Bible from routed search and version params", async () => {
    const store = createBibleStore();

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext() as any}
        >
          <MemoryRouter
            initialEntries={["/controller/bible?search=John%203:1&version=NIV"]}
          >
            <Bible />
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>
    );

    await waitFor(() => {
      expect(store.getState().bible.searchValues.startVerse).toBe("1");
    });

    const state = store.getState().bible;
    expect(state.version).toBe("niv");
    expect(state.search).toBe("John 3:1");
    expect(state.searchValues.book).toBe("John");
    expect(state.searchValues.chapter).toBe("3");
  });
});
