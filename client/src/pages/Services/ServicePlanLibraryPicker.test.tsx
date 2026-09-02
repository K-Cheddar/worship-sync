import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import ServicePlanLibraryPicker from "./ServicePlanLibraryPicker";
import { createNewSong } from "../../utils/itemUtil";
import {
  createMockControllerContext,
  createMockGlobalContext,
} from "../../test/mocks";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  createItemSlice,
  initialCreateItemState,
} from "../../store/createItemSlice";
import { allItemsSlice } from "../../store/allItemsSlice";
import { allDocsSlice } from "../../store/allDocsSlice";
import { itemListSlice } from "../../store/itemListSlice";
import { itemSlice } from "../../store/itemSlice";
import { preferencesSlice } from "../../store/preferencesSlice";
import type { ServiceItem } from "../../types";

jest.mock("../../utils/itemUtil", () => {
  const actual = jest.requireActual("../../utils/itemUtil");
  return {
    ...actual,
    createNewSong: jest.fn(),
  };
});

jest.mock("../../api/lrclib", () => ({
  resolveLrclibImport: jest.fn(),
  searchLrclibTracks: jest.fn().mockResolvedValue([]),
}));

const mockCreateNewSong = jest.mocked(createNewSong);

const songDocs = [
  {
    _id: "song-1",
    name: "Living Hope",
    type: "song" as const,
    arrangements: [
      {
        name: "Default",
        formattedLyrics: [
          { name: "Verse 1", words: "How great the chasm that lay between us" },
        ],
      },
    ],
  },
  {
    _id: "song-2",
    name: "Great Are You Lord",
    type: "song" as const,
    arrangements: [
      {
        name: "Default",
        formattedLyrics: [
          { name: "Verse 1", words: "You give life, You are love" },
        ],
      },
    ],
  },
];

const songItems: ServiceItem[] = [
  {
    _id: "song-1",
    name: "Living Hope",
    type: "song",
    listId: "song-1",
    background: "",
  },
  {
    _id: "song-2",
    name: "Great Are You Lord",
    type: "song",
    listId: "song-2",
    background: "",
  },
];

const createUndoableState = () => ({
  past: [],
  present: {
    preferences: preferencesSlice.getInitialState(),
  },
  future: [],
});

const createPickerStore = ({
  allItemsList = songItems,
  isAllItemsLoading = false,
}: {
  allItemsList?: ServiceItem[];
  isAllItemsLoading?: boolean;
} = {}) => {
  const undoableState = createUndoableState();

  return configureStore({
    reducer: {
      createItem: createItemSlice.reducer,
      allItems: allItemsSlice.reducer,
      allDocs: allDocsSlice.reducer,
      itemList: itemListSlice.reducer,
      item: itemSlice.reducer,
      undoable: (state = undoableState) => state,
    } as never,
    preloadedState: {
      createItem: initialCreateItemState,
      allItems: {
        ...allItemsSlice.getInitialState(),
        list: allItemsList,
        isAllItemsLoading,
        isInitialized: true,
      },
      allDocs: {
        ...allDocsSlice.getInitialState(),
        allSongDocs: songDocs,
      },
      itemList: itemListSlice.getInitialState(),
      item: itemSlice.getInitialState(),
      undoable: undoableState,
    } as never,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
        immutableCheck: false,
      }),
  });
};

const songTitleMatcher = (name: string) => (_: string, element: Element | null) => {
  if (!element || element.tagName.toLowerCase() !== "p") return false;
  const compact = (value: string) => value.replace(/\s+/g, "");
  return compact(element.textContent || "") === compact(name);
};

const attachSongNamed = async (
  user: ReturnType<typeof userEvent.setup>,
  songName: string,
) => {
  await screen.findByText(songTitleMatcher(songName));
  const row = screen
    .getAllByRole("listitem")
    .find((item) => within(item).queryByText(songTitleMatcher(songName)));
  expect(row).toBeTruthy();
  await user.click(within(row as HTMLElement).getByRole("button", { name: /^Attach$/i }));
};

const renderPicker = (
  store = createPickerStore(),
  props: {
    initialQuery?: string;
    initialLyrics?: string;
    startInCreate?: boolean;
    controllerContext?: ReturnType<typeof createMockControllerContext>;
  } = {},
) => {
  const onSelectSong = jest.fn();
  const onClose = jest.fn();
  const {
    controllerContext = createMockControllerContext(),
    ...pickerProps
  } = props;
  render(
    <Provider store={store}>
      <MemoryRouter>
        <ControllerInfoContext.Provider value={controllerContext as never}>
          <GlobalInfoContext.Provider value={createMockGlobalContext() as never}>
            <ServicePlanLibraryPicker
              isOpen
              onClose={onClose}
              onSelectSong={onSelectSong}
              {...pickerProps}
            />
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </MemoryRouter>
    </Provider>,
  );
  return { onSelectSong, onClose, store };
};

describe("ServicePlanLibraryPicker", () => {
  let getBoundingClientRectSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateNewSong.mockResolvedValue({
      _id: "song-new",
      name: "Brand New Song",
      type: "song",
      background: "",
    } as never);
    getBoundingClientRectSpy = jest
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        return {
          width: 800,
          height: 600,
          top: 0,
          left: 0,
          bottom: 600,
          right: 800,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      });
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
  });

  it("attaches an existing library song as a reference via FilteredItems", async () => {
    const user = userEvent.setup();
    const { onSelectSong } = renderPicker();

    await waitFor(() => {
      expect(screen.getByText(songTitleMatcher("Living Hope"))).toBeInTheDocument();
    });
    await attachSongNamed(user, "Living Hope");

    expect(onSelectSong).toHaveBeenCalledWith({
      kind: "library",
      songId: "song-1",
      songName: "Living Hope",
    });
  });

  it("shows songs from allSongDocs when allItems is still loading (Teams session)", async () => {
    renderPicker(
      createPickerStore({ allItemsList: [], isAllItemsLoading: true }),
    );

    await waitFor(() => {
      expect(screen.getByText(songTitleMatcher("Living Hope"))).toBeInTheDocument();
    });
    expect(screen.queryByText(/Songs are loading/i)).not.toBeInTheDocument();
  });

  it("keeps existing document-backed songs when allItems contains only a newly created song", async () => {
    const partialSongItems = [
      {
        _id: "song-new",
        name: "Brand New Song",
        type: "song" as const,
        listId: "",
        background: "",
      },
    ];
    const store = createPickerStore({ allItemsList: partialSongItems });
    store.dispatch(
      allDocsSlice.actions.upsertItemInAllDocs({
        _id: "song-new",
        name: "Brand New Song",
        type: "song",
      } as never),
    );

    renderPicker(store);

    expect(await screen.findByText(songTitleMatcher("Living Hope"))).toBeInTheDocument();
    expect(screen.getByText(songTitleMatcher("Great Are You Lord"))).toBeInTheDocument();
    expect(screen.getByText(songTitleMatcher("Brand New Song"))).toBeInTheDocument();
  });

  it("shows create chrome under search and hides outline delete", async () => {
    renderPicker();

    await waitFor(() => {
      expect(screen.getByText(songTitleMatcher("Living Hope"))).toBeInTheDocument();
    });

    expect(screen.getAllByRole("button", { name: /View song details/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Add to outline/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Search external lyrics/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Create a new song/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create a new song/i })).toBeInTheDocument();
    expect(screen.getByText(/Can't find what you're looking for/i)).toBeInTheDocument();
  });

  it("filters the library by search", async () => {
    const user = userEvent.setup();
    renderPicker();

    await waitFor(() => {
      expect(screen.getByText(songTitleMatcher("Living Hope"))).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/^Search/i), "Are You Lord");

    await waitFor(() => {
      expect(screen.queryByText(songTitleMatcher("Living Hope"))).not.toBeInTheDocument();
    });
    expect(screen.getByText(songTitleMatcher("Great Are You Lord"))).toBeInTheDocument();
  });

  it("replaces the search UI with the Controller create song form", async () => {
    const user = userEvent.setup();
    renderPicker();

    await waitFor(() => {
      expect(screen.getByText(songTitleMatcher("Living Hope"))).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Create a new song/i }));

    expect(screen.getByRole("heading", { name: /Create song/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Song name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import Lyrics/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Lyrics/i)).toBeInTheDocument();
    expect(screen.queryByText(songTitleMatcher("Living Hope"))).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Back to song search/i }),
    ).toBeInTheDocument();
  });

  it("opens on the create form with a pending title and lyrics seeded", async () => {
    renderPicker(createPickerStore(), {
      startInCreate: true,
      initialQuery: "Appeal Song",
      initialLyrics: "Come as you are",
    });

    expect(
      await screen.findByRole("heading", { name: /Create song/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Song name/i)).toHaveValue("Appeal Song");
    expect(screen.getByLabelText(/^Lyrics/i)).toHaveValue("Come as you are");
    expect(screen.queryByText(songTitleMatcher("Living Hope"))).not.toBeInTheDocument();
  });

  it("creates a new library song through CreateItem and attaches it", async () => {
    const user = userEvent.setup();
    const { onSelectSong } = renderPicker();

    await user.click(screen.getByRole("button", { name: /Create a new song/i }));
    await user.type(screen.getByLabelText(/Song name/i), "Brand New Song");
    await user.click(screen.getByRole("button", { name: /Create and attach/i }));

    await waitFor(() => expect(mockCreateNewSong).toHaveBeenCalled());
    expect(mockCreateNewSong.mock.calls[0][0]).toMatchObject({
      name: "Brand New Song",
    });
    expect(onSelectSong).toHaveBeenCalledWith({
      kind: "library",
      songId: "song-new",
      songName: "Brand New Song",
    });
  });

  it("waits for the song library before allowing a new song to be attached", async () => {
    const user = userEvent.setup();
    const controllerContext = createMockControllerContext();
    controllerContext.db = undefined;
    renderPicker(createPickerStore(), {
      controllerContext,
    });

    await user.click(screen.getByRole("button", { name: /Create a new song/i }));
    await user.type(screen.getByLabelText(/Song name/i), "Brand New Song");

    expect(screen.getByRole("status")).toHaveTextContent(
      "Song library is still connecting.",
    );
    expect(screen.getByRole("button", { name: /Create and attach/i })).toBeDisabled();
  });
});
