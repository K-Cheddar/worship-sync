import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import CreateItem from "./CreateItem";
import {
  createItemSlice,
  initialCreateItemState,
} from "../../store/createItemSlice";
import { allItemsSlice } from "../../store/allItemsSlice";
import { itemListSlice } from "../../store/itemListSlice";
import { itemSlice } from "../../store/itemSlice";
import { timersSlice } from "../../store/timersSlice";
import { bibleSlice } from "../../store/bibleSlice";
import { presentationSlice } from "../../store/presentationSlice";
import { preferencesSlice } from "../../store/preferencesSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  createMockControllerContext,
  createMockGlobalContext,
} from "../../test/mocks";
import type { ItemState, ServiceItem } from "../../types";
import {
  createNewFreeForm,
  createNewSong,
  createNewTimer,
} from "../../utils/itemUtil";

jest.mock("../../utils/itemUtil", () => {
  const actual = jest.requireActual("../../utils/itemUtil");
  return {
    ...actual,
    createNewSong: jest.fn(),
    createNewFreeForm: jest.fn(),
    createNewTimer: jest.fn(),
  };
});

const mockedCreateNewSong = createNewSong as jest.MockedFunction<
  typeof createNewSong
>;
const mockedCreateNewFreeForm = createNewFreeForm as jest.MockedFunction<
  typeof createNewFreeForm
>;
const mockedCreateNewTimer = createNewTimer as jest.MockedFunction<
  typeof createNewTimer
>;

const createMockItem = (overrides: Partial<ItemState> = {}): ItemState => ({
  name: "Created Item",
  _id: "item-123",
  type: "song",
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

const BibleRouteProbe = () => {
  const [searchParams] = useSearchParams();
  return <div data-testid="bible-page">{searchParams.get("name")}</div>;
};

const createTestStore = ({
  createItem = initialCreateItemState,
  allItemsList = [],
}: {
  createItem?: ReturnType<typeof createItemSlice.reducer>;
  allItemsList?: ServiceItem[];
} = {}) => {
  const undoableState = createUndoableState();

  return configureStore({
    reducer: {
      createItem: createItemSlice.reducer,
      allItems: allItemsSlice.reducer,
      itemList: itemListSlice.reducer,
      item: itemSlice.reducer,
      timers: timersSlice.reducer,
      bible: bibleSlice.reducer,
      presentation: presentationSlice.reducer,
      undoable: (state = undoableState) => state,
    } as any,
    preloadedState: {
      createItem,
      allItems: {
        ...allItemsSlice.getInitialState(),
        list: allItemsList,
        isAllItemsLoading: false,
        isInitialized: true,
      },
      itemList: itemListSlice.getInitialState(),
      item: itemSlice.getInitialState(),
      timers: timersSlice.getInitialState(),
      bible: bibleSlice.getInitialState(),
      presentation: presentationSlice.getInitialState(),
      undoable: undoableState,
    } as any,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
        immutableCheck: false,
      }),
  });
};

const renderCreateItem = ({
  store = createTestStore(),
  initialEntry = "/controller/create",
} = {}) => {
  const controllerContext = createMockControllerContext();
  const globalContext = createMockGlobalContext();

  return {
    store,
    ...render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={controllerContext as any}>
          <GlobalInfoContext.Provider value={globalContext as any}>
            <MemoryRouter initialEntries={[initialEntry]}>
              <Routes>
                <Route path="/controller/create" element={<CreateItem />} />
                <Route path="/controller/bible" element={<BibleRouteProbe />} />
                <Route
                  path="/controller/item/:itemId/:listId"
                  element={<div data-testid="item-page">Item Page</div>}
                />
              </Routes>
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>
    ),
  };
};

describe("CreateItem", () => {
  beforeEach(() => {
    mockedCreateNewSong.mockReset();
    mockedCreateNewFreeForm.mockReset();
    mockedCreateNewTimer.mockReset();
  });

  it("persists the song draft when leaving and returning", () => {
    const store = createTestStore();
    const firstRender = renderCreateItem({ store });

    fireEvent.change(screen.getByLabelText("Item Name:"), {
      target: { value: "Amazing Grace" },
    });
    fireEvent.change(screen.getByLabelText("Paste Text Here:"), {
      target: { value: "Verse 1" },
    });

    firstRender.unmount();
    renderCreateItem({ store });

    expect(screen.getByLabelText("Item Name:")).toHaveValue("Amazing Grace");
    expect(screen.getByLabelText("Paste Text Here:")).toHaveValue("Verse 1");
  });

  it("persists timer values when leaving and returning", () => {
    const store = createTestStore();
    const firstRender = renderCreateItem({ store });

    fireEvent.click(screen.getAllByLabelText("Timer:")[0]);
    fireEvent.change(screen.getByLabelText("Hours:"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Minutes:"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Seconds:"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByLabelText("Countdown:"));
    fireEvent.change(screen.getByLabelText("Countdown To:"), {
      target: { value: "09:30" },
    });

    firstRender.unmount();
    renderCreateItem({ store });

    expect(screen.getByLabelText("Countdown:")).toBeChecked();
    expect(screen.getByLabelText("Countdown To:")).toHaveValue("09:30");
    expect(store.getState().createItem.hours).toBe(1);
    expect(store.getState().createItem.minutes).toBe(2);
    expect(store.getState().createItem.seconds).toBe(3);
  });

  it("lets filtered-list query params override the saved draft", async () => {
    const store = createTestStore({
      createItem: {
        name: "Old Draft",
        type: "timer",
        text: "Keep me",
        hours: 4,
        minutes: 5,
        seconds: 6,
        time: "10:45",
        timerType: "countdown",
      },
    });

    renderCreateItem({
      store,
      initialEntry: "/controller/create?type=song&name=Grace",
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Item Name:")).toHaveValue("Grace");
    });

    expect(screen.getByLabelText("Song:")).toBeChecked();
    expect(screen.getByLabelText("Paste Text Here:")).toHaveValue("");
    expect(store.getState().createItem).toEqual({
      ...initialCreateItemState,
      name: "Grace",
      type: "song",
    });
  });

  it("clears the draft after a successful song create", async () => {
    mockedCreateNewSong.mockResolvedValue(
      createMockItem({
        name: "Created Song",
        _id: "song-1",
        type: "song",
      })
    );

    const store = createTestStore({
      createItem: {
        ...initialCreateItemState,
        name: "Created Song",
        text: "Verse 1",
      },
    });

    renderCreateItem({ store });

    fireEvent.click(screen.getByRole("button", { name: "Create Song" }));

    await waitFor(() => {
      expect(mockedCreateNewSong).toHaveBeenCalled();
    });

    expect(store.getState().createItem).toEqual(initialCreateItemState);
    await waitFor(() => {
      expect(screen.getByTestId("item-page")).toBeInTheDocument();
    });
  });

  it("keeps the draft after adding an existing item to the outline", () => {
    const store = createTestStore({
      createItem: {
        ...initialCreateItemState,
        name: "Amazing Grace",
        text: "Verse 1",
      },
      allItemsList: [
        {
          _id: "existing-song",
          listId: "list-1",
          name: "Amazing Grace",
          type: "song",
        },
      ],
    });

    renderCreateItem({ store });

    fireEvent.click(screen.getByRole("button", { name: "Add to outline" }));

    expect(store.getState().createItem.name).toBe("Amazing Grace");
    expect(store.getState().createItem.text).toBe("Verse 1");
  });

  it("keeps the draft when navigating to Bible and back without creating", async () => {
    const store = createTestStore();
    const firstRender = renderCreateItem({ store });

    fireEvent.click(screen.getByLabelText("Bible:"));
    fireEvent.change(screen.getByLabelText("Item Name:"), {
      target: { value: "John Reading" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Bible" }));

    await waitFor(() => {
      expect(screen.getByTestId("bible-page")).toHaveTextContent("John Reading");
    });

    expect(store.getState().createItem.name).toBe("John Reading");
    expect(store.getState().createItem.type).toBe("bible");

    firstRender.unmount();
    renderCreateItem({ store });

    expect(screen.getByLabelText("Item Name:")).toHaveValue("John Reading");
    expect(screen.getByLabelText("Bible:")).toBeChecked();
  });
});
