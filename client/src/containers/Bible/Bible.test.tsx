import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import {
  createBibleItemFromParsedReference,
  loadBibleChapterVerses,
  selectBibleVersesFromRange,
} from "../../utils/servicePlanningBibleImport";

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

jest.mock("../../utils/servicePlanningBibleImport", () => ({
  createBibleItemFromParsedReference: jest.fn(),
  loadBibleChapterVerses: jest.fn(),
  selectBibleVersesFromRange: jest.fn((verses) => verses),
}));

const mockedCreateBibleItemFromParsedReference =
  createBibleItemFromParsedReference as jest.MockedFunction<
    typeof createBibleItemFromParsedReference
  >;
const mockedLoadBibleChapterVerses =
  loadBibleChapterVerses as jest.MockedFunction<typeof loadBibleChapterVerses>;
const mockedSelectBibleVersesFromRange =
  selectBibleVersesFromRange as jest.MockedFunction<
    typeof selectBibleVersesFromRange
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
    window.sessionStorage.clear();
    mockedCreateNewBible.mockReset();
    mockedCreateBibleItemFromParsedReference.mockReset();
    mockedLoadBibleChapterVerses.mockReset();
    mockedSelectBibleVersesFromRange.mockClear();
    mockedSelectBibleVersesFromRange.mockImplementation((verses) => verses);
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

  it("hydrates a Bible search with a trailing version code", async () => {
    const store = createBibleStore();
    store.dispatch(bibleSlice.actions.setVersion("esv"));

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext() as any}
        >
          <MemoryRouter
            initialEntries={[
              "/controller/bible?search=Psalm%2078%2040-64%20NKJV",
            ]}
          >
            <Bible />
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>
    );

    await waitFor(() => {
      expect(store.getState().bible.searchValues.endVerse).toBe("64");
    });

    const state = store.getState().bible;
    expect(state.version).toBe("nkjv");
    expect(state.searchValues.book).toBe("Psalm");
    expect(state.searchValues.chapter).toBe("78");
    expect(state.searchValues.startVerse).toBe("40");
  });

  it("imports multiple Bible references into a review view", async () => {
    const user = userEvent.setup();
    const store = createBibleStore();
    mockedLoadBibleChapterVerses.mockResolvedValue([
      { name: "16", index: 15, text: "I will ask the Father" },
    ]);

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext() as any}
        >
          <MemoryRouter initialEntries={["/controller/bible"]}>
            <Bible />
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Import" }));
    await user.type(
      screen.getByLabelText(/Bible references/i),
      "Main Text: John 14:16-18\nAll NKJV",
    );
    await user.click(screen.getByRole("button", { name: "Import multiple" }));

    expect(
      await screen.findByRole("heading", { name: "Bible import review" }),
    ).toBeInTheDocument();
    expect(screen.getByText("John 14:16-18 NKJV")).toBeInTheDocument();
    expect(screen.getByText("I will ask the Father")).toBeInTheDocument();
  });

  it("adds selected imported Bible references one at a time", async () => {
    const user = userEvent.setup();
    const store = createBibleStore();
    mockedLoadBibleChapterVerses.mockResolvedValue([
      { name: "16", index: 15, text: "I will ask the Father" },
    ]);
    mockedCreateBibleItemFromParsedReference
      .mockResolvedValueOnce(
        createMockItem({ _id: "bulk-1", name: "John 14:16-18 NKJV" }),
      )
      .mockResolvedValueOnce(
        createMockItem({ _id: "bulk-2", name: "Acts 1:4-8 NKJV" }),
      );

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext() as any}
        >
          <MemoryRouter initialEntries={["/controller/bible"]}>
            <Bible />
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>
    );

    await user.click(screen.getByRole("button", { name: "Import" }));
    await user.type(
      screen.getByLabelText(/Bible references/i),
      "John 14:16-18; Acts 1:4-8\nAll NKJV",
    );
    await user.click(screen.getByRole("button", { name: "Import multiple" }));

    await screen.findByRole("heading", { name: "Bible import review" });
    await user.click(screen.getByRole("button", { name: "Add selected" }));

    await waitFor(() => {
      expect(mockedCreateBibleItemFromParsedReference).toHaveBeenCalledTimes(2);
    });
    expect(mockedCreateBibleItemFromParsedReference).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        parsedRef: expect.objectContaining({
          book: "John",
          chapter: "14",
          verseRange: "16-18",
          version: "nkjv",
        }),
      }),
    );
    expect(mockedCreateBibleItemFromParsedReference).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        parsedRef: expect.objectContaining({
          book: "Acts",
          chapter: "1",
          verseRange: "4-8",
          version: "nkjv",
        }),
      }),
    );
    expect(store.getState().itemList.list).toHaveLength(2);
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Bible import review" }),
      ).not.toBeInTheDocument();
    });
    expect(window.sessionStorage.getItem("worshipSync_bibleBulkImport_activeId"))
      .toBeNull();
  });

  it("restores the active import review when returning to the Bible page", async () => {
    const store = createBibleStore();
    const review = {
      id: "review-1",
      createdAt: new Date().toISOString(),
      inputVersion: "nkjv",
      rows: [
        {
          id: "john-14-16-18-nkjv-0",
          book: "John",
          chapter: "14",
          verseRange: "16-18",
          version: "nkjv",
          sourceText: "John 14:16-18",
          status: "ready",
          textPreview: "I will ask the Father",
        },
      ],
    };
    window.sessionStorage.setItem(
      "worshipSync_bibleBulkImport_activeId",
      "review-1",
    );
    window.sessionStorage.setItem(
      "worshipSync_bibleBulkImport_review-1",
      JSON.stringify(review),
    );

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext() as any}
        >
          <MemoryRouter initialEntries={["/controller/bible"]}>
            <Bible />
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    expect(
      await screen.findByRole("heading", { name: "Bible import review" }),
    ).toBeInTheDocument();
    expect(screen.getByText("John 14:16-18 NKJV")).toBeInTheDocument();
  });
});
