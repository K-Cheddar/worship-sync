import React from "react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import {
  MemoryRouter,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from "react-router-dom";
import CreateItem from "./CreateItem";
import {
  createItemSlice,
  initialCreateItemState,
} from "../../store/createItemSlice";
import { allItemsSlice } from "../../store/allItemsSlice";
import { allDocsSlice } from "../../store/allDocsSlice";
import { itemListSlice } from "../../store/itemListSlice";
import { itemSlice } from "../../store/itemSlice";
import { timersSlice } from "../../store/timersSlice";
import { bibleSlice } from "../../store/bibleSlice";
import { presentationSlice } from "../../store/presentationSlice";
import { preferencesSlice } from "../../store/preferencesSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ActiveControllerProvider } from "../../context/activeController";
import {
  createMockControllerContext,
  createMockGlobalContext,
} from "../../test/mocks";
import type { ItemState, ServiceItem } from "../../types";
import type { NormalizedLrclibTrack } from "../../utils/lrclib";
import {
  createNewFreeForm,
  createNewSong,
  createNewTimer,
} from "../../utils/itemUtil";
import {
  fetchGeniusLyricsLocally,
  resolveLrclibImport,
} from "../../api/lrclib";
import generateRandomId from "../../utils/generateRandomId";

jest.mock("../../utils/itemUtil", () => {
  const actual = jest.requireActual("../../utils/itemUtil");
  return {
    ...actual,
    createNewSong: jest.fn(),
    createNewFreeForm: jest.fn(),
    createNewTimer: jest.fn(),
  };
});

jest.mock("../../api/lrclib", () => ({
  resolveLrclibImport: jest.fn(),
  fetchGeniusLyricsLocally: jest.fn(),
}));

jest.mock("../../utils/generateRandomId");

const AUX_CONTROLLER_ID = "ctrl_lobby";

const mockedCreateNewSong = createNewSong as jest.MockedFunction<
  typeof createNewSong
>;
const mockedCreateNewFreeForm = createNewFreeForm as jest.MockedFunction<
  typeof createNewFreeForm
>;
const mockedCreateNewTimer = createNewTimer as jest.MockedFunction<
  typeof createNewTimer
>;
const mockedResolveLrclibImport = resolveLrclibImport as jest.MockedFunction<
  typeof resolveLrclibImport
>;
const mockedFetchGeniusLyricsLocally = fetchGeniusLyricsLocally as jest.MockedFunction<
  typeof fetchGeniusLyricsLocally
>;
const mockedGenerateRandomId = jest.mocked(generateRandomId);

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

const ItemRouteProbe = () => {
  const { itemId, listId } = useParams();
  return (
    <div data-testid="item-page">
      {itemId}:{listId}
    </div>
  );
};

const createTestStore = ({
  createItem = initialCreateItemState,
  allItemsList = [],
  allSongDocs = [],
  isAllItemsInitialized = true,
}: {
  createItem?: ReturnType<typeof createItemSlice.reducer>;
  allItemsList?: ServiceItem[];
  allSongDocs?: ItemState[];
  isAllItemsInitialized?: boolean;
} = {}) => {
  const undoableState = createUndoableState();

  return configureStore({
    reducer: {
      createItem: createItemSlice.reducer,
      allItems: allItemsSlice.reducer,
      allDocs: allDocsSlice.reducer,
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
        isInitialized: isAllItemsInitialized,
      },
      allDocs: {
        ...allDocsSlice.getInitialState(),
        allSongDocs,
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
  controllerProfileId,
  db,
}: {
  store?: ReturnType<typeof createTestStore>;
  initialEntry?: string;
  controllerProfileId?: string;
  db?: PouchDB.Database;
} = {}) => {
  const controllerContext = createMockControllerContext(db ? { db } : {});
  const globalContext = createMockGlobalContext();

  const routes = (
    <Routes>
      <Route path="/controller/create" element={<CreateItem />} />
      <Route path="/controller/bible" element={<BibleRouteProbe />} />
      <Route
        path="/controller/item/:itemId/:listId"
        element={<ItemRouteProbe />}
      />
      <Route
        path="/aux-controller/:profileId/create"
        element={<CreateItem />}
      />
    </Routes>
  );

  return {
    store,
    ...render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={controllerContext as any}>
          <GlobalInfoContext.Provider value={globalContext as any}>
            <MemoryRouter initialEntries={[initialEntry]}>
              {controllerProfileId ? (
                <ActiveControllerProvider profileId={controllerProfileId}>
                  {routes}
                </ActiveControllerProvider>
              ) : (
                routes
              )}
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>
    ),
  };
};

describe("CreateItem", () => {
  it("ignores an import result after the song draft is renamed", async () => {
    let finish!: (value: Awaited<ReturnType<typeof resolveLrclibImport>>) => void;
    mockedResolveLrclibImport.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const a = createMockItem({ _id: "song-A", name: "Song A" });
    const b = createMockItem({ _id: "song-B", name: "Song B" });
    const docs = new Map([[a._id, a], [b._id, b]]);
    const db = {
      get: jest.fn(async (id: string) => {
        const found = docs.get(id);
        if (!found) throw Object.assign(new Error("not found"), { status: 404 });
        return found;
      }),
      put: jest.fn(async (doc: ItemState) => { docs.set(doc._id, doc); return { rev: "1-created" }; }),
    };
    mockedCreateNewSong.mockImplementation(jest.requireActual("../../utils/itemUtil").createNewSong);
    const store = createTestStore({
      createItem: { ...initialCreateItemState, name: "Song A" }, allSongDocs: [a, b],
    });
    renderCreateItem({ store, db: db as never });
    fireEvent.click(screen.getByRole("button", { name: "Import Lyrics" }));
    fireEvent.change(screen.getByLabelText("Song name:"), { target: { value: "Song B" } });
    await act(async () => finish({
      match: { source: "genius", geniusId: 17, trackName: "Song A", artistName: "Artist A",
        albumName: "", plainLyrics: "Song A exclusive imported lyrics", syncedLyrics: null },
      candidates: [],
    }));
    expect(store.getState().createItem.name).toBe("Song B");
    expect(store.getState().createItem.text).toBe("");
    expect(store.getState().allDocs.allSongDocs).toEqual([a, b]);
    fireEvent.click(screen.getByRole("button", { name: "Create Song" }));
    fireEvent.click(screen.getByRole("button", { name: "Create separate song" }));
    await waitFor(() => expect(db.put).toHaveBeenCalledTimes(1));
    const created = [...docs.values()].filter(doc => !["song-A", "song-B"].includes(doc._id));
    expect(created).toHaveLength(1);
    expect(created[0].name).toBe("Song B");
    expect(JSON.stringify(created[0])).not.toContain("Song A exclusive imported lyrics");
    expect(docs.get(a._id)).toEqual(a);
    expect(docs.get(b._id)).toEqual(b);
  });

  it("keeps lyrics typed manually while an import is pending", async () => {
    let finish!: (value: Awaited<ReturnType<typeof resolveLrclibImport>>) => void;
    mockedResolveLrclibImport.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const store = createTestStore({
      createItem: { ...initialCreateItemState, name: "Song A" },
    });
    renderCreateItem({ store });

    fireEvent.click(screen.getByRole("button", { name: "Import Lyrics" }));
    fireEvent.change(screen.getByLabelText("Lyrics:"), {
      target: { value: "Operator's manual lyrics" },
    });
    await act(async () => finish({
      match: {
        source: "genius",
        geniusId: 19,
        trackName: "Song A",
        artistName: "Artist A",
        albumName: "",
        plainLyrics: "Late imported lyrics",
        syncedLyrics: null,
      },
      candidates: [],
    }));

    expect(store.getState().createItem.text).toBe("Operator's manual lyrics");
  });

  it("ignores an older request after a newer import starts", async () => {
    const resolvers: Array<(value: Awaited<ReturnType<typeof resolveLrclibImport>>) => void> = [];
    mockedResolveLrclibImport.mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));
    const store = createTestStore({
      createItem: { ...initialCreateItemState, name: "Song A" },
    });
    renderCreateItem({ store });

    fireEvent.click(screen.getByRole("button", { name: "Import Lyrics" }));
    fireEvent.change(screen.getByLabelText("Song name:"), { target: { value: "Song B" } });
    fireEvent.click(screen.getByRole("button", { name: "Import Lyrics" }));
    expect(resolvers).toHaveLength(2);

    await act(async () => resolvers[0]({
      match: {
        source: "genius",
        geniusId: 20,
        trackName: "Song A",
        artistName: "Artist A",
        albumName: "",
        plainLyrics: "Song A only",
        syncedLyrics: null,
      },
      candidates: [],
    }));
    expect(store.getState().createItem.name).toBe("Song B");
    expect(store.getState().createItem.text).toBe("");
    expect(screen.getByRole("status", { name: "Loading lyrics results" })).toBeInTheDocument();

    await act(async () => resolvers[1]({
      match: {
        source: "genius",
        geniusId: 21,
        trackName: "Song B",
        artistName: "Artist B",
        albumName: "",
        plainLyrics: "Song B only",
        syncedLyrics: null,
      },
      candidates: [],
    }));
    expect(store.getState().createItem.text).toBe("Song B only");
  });

  it("ignores an import that finishes after leaving and returning to Create Item", async () => {
    let finish!: (value: Awaited<ReturnType<typeof resolveLrclibImport>>) => void;
    mockedResolveLrclibImport.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const store = createTestStore({
      createItem: { ...initialCreateItemState, name: "Song A" },
    });
    const view = renderCreateItem({ store });
    fireEvent.click(screen.getByRole("button", { name: "Import Lyrics" }));
    view.unmount();
    renderCreateItem({ store });

    await act(async () => finish({
      match: {
        source: "genius",
        geniusId: 22,
        trackName: "Song A",
        artistName: "Artist A",
        albumName: "",
        plainLyrics: "Late page lyrics",
        syncedLyrics: null,
      },
      candidates: [],
    }));

    expect(store.getState().createItem.name).toBe("Song A");
    expect(store.getState().createItem.text).toBe("");
  });

  beforeEach(() => {
    mockedCreateNewSong.mockReset();
    mockedCreateNewFreeForm.mockReset();
    mockedCreateNewTimer.mockReset();
    mockedResolveLrclibImport.mockReset();
    mockedFetchGeniusLyricsLocally.mockReset();
    let n = 0;
    mockedGenerateRandomId.mockImplementation(() => `list-id-${++n}`);
  });

  it("keeps song first and selected on the presentation controller", () => {
    renderCreateItem();

    const typeRadios = screen.getAllByRole("radio");
    expect(typeRadios[0]).toHaveAccessibleName(/Song/);
    expect(typeRadios[2]).toHaveAccessibleName(/Custom Item/);
    expect(screen.getByLabelText("Song:")).toBeChecked();
  });

  it("defaults to custom first on aux controllers", async () => {
    const store = createTestStore();
    renderCreateItem({
      store,
      initialEntry: `/aux-controller/${AUX_CONTROLLER_ID}/create`,
      controllerProfileId: AUX_CONTROLLER_ID,
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Custom Item:")).toBeChecked();
    });
    const typeRadios = screen.getAllByRole("radio");
    expect(typeRadios[0]).toHaveAccessibleName(/Custom Item/);
    expect(typeRadios[1]).toHaveAccessibleName(/Song/);
    expect(store.getState().createItem.type).toBe("free");
  });

  it("does not overwrite an in-progress draft when opened on aux", () => {
    const store = createTestStore({
      createItem: {
        ...initialCreateItemState,
        type: "song",
        name: "Already drafting",
        text: "Verse",
      },
    });

    renderCreateItem({
      store,
      initialEntry: `/aux-controller/${AUX_CONTROLLER_ID}/create`,
      controllerProfileId: AUX_CONTROLLER_ID,
    });

    expect(screen.getByLabelText("Song:")).toBeChecked();
    expect(screen.getByLabelText("Song name:")).toHaveValue("Already drafting");
    expect(store.getState().createItem.type).toBe("song");
  });

  it("lets the operator switch away from the aux custom default", async () => {
    const store = createTestStore();
    renderCreateItem({
      store,
      initialEntry: `/aux-controller/${AUX_CONTROLLER_ID}/create`,
      controllerProfileId: AUX_CONTROLLER_ID,
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Custom Item:")).toBeChecked();
    });

    fireEvent.click(screen.getByLabelText("Song:"));

    expect(screen.getByLabelText("Song:")).toBeChecked();
    expect(store.getState().createItem.type).toBe("song");
    expect(store.getState().createItem.hasUserSelectedType).toBe(true);
  });

  it("keeps an explicit blank song choice on aux after remount", async () => {
    const store = createTestStore();
    const view = renderCreateItem({
      store,
      initialEntry: `/aux-controller/${AUX_CONTROLLER_ID}/create`,
      controllerProfileId: AUX_CONTROLLER_ID,
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Custom Item:")).toBeChecked();
    });

    fireEvent.click(screen.getByLabelText("Song:"));
    view.unmount();

    renderCreateItem({
      store,
      initialEntry: `/aux-controller/${AUX_CONTROLLER_ID}/create`,
      controllerProfileId: AUX_CONTROLLER_ID,
    });

    expect(screen.getByLabelText("Song:")).toBeChecked();
    expect(store.getState().createItem.type).toBe("song");
  });

  it("adopts the presentation default when a blank aux draft opens on main", async () => {
    const store = createTestStore({
      createItem: {
        ...initialCreateItemState,
        type: "free",
        hasUserSelectedType: false,
      },
    });

    renderCreateItem({ store });

    await waitFor(() => {
      expect(screen.getByLabelText("Song:")).toBeChecked();
    });
    expect(store.getState().createItem.type).toBe("song");
  });

  it("persists the song draft when leaving and returning", () => {
    const store = createTestStore();
    const view = renderCreateItem({ store });

    fireEvent.change(screen.getByLabelText("Song name:"), {
      target: { value: "Amazing Grace" },
    });
    fireEvent.change(screen.getByLabelText("Lyrics:"), {
      target: { value: "Verse 1" },
    });

    view.unmount();
    renderCreateItem({ store });

    expect(screen.getByLabelText("Song name:")).toHaveValue("Amazing Grace");
    expect(screen.getByLabelText("Lyrics:")).toHaveValue("Verse 1");
  });

  it("persists timer values when leaving and returning", () => {
    const store = createTestStore();
    const view = renderCreateItem({ store });

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

    view.unmount();
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
        ...initialCreateItemState,
        name: "Old Draft",
        type: "timer",
        text: "Keep me",
        songArtist: "",
        songAlbum: "",
        songMetadata: null,
        hours: 4,
        minutes: 5,
        seconds: 6,
        time: "10:45",
        timerType: "countdown",
        lyricsImportCandidates: [],
        lyricsImportError: "",
        hasUserSelectedType: true,
      },
    });

    renderCreateItem({
      store,
      initialEntry: "/controller/create?type=song&name=Grace",
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Song name:")).toHaveValue("Grace");
    });

    expect(screen.getByLabelText("Song:")).toBeChecked();
    expect(screen.getByLabelText("Lyrics:")).toHaveValue("");
    expect(store.getState().createItem).toMatchObject({
      name: "Grace",
      type: "song",
      hasUserSelectedType: true,
    });
    expect(store.getState().createItem.draftId).toBeGreaterThan(
      initialCreateItemState.draftId,
    );
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

    expect({ ...store.getState().createItem, draftId: 0 }).toEqual(initialCreateItemState);
    expect(store.getState().createItem.draftId).not.toBe(0);
    await waitFor(() => {
      expect(screen.getByTestId("item-page")).toBeInTheDocument();
    });
    expect(store.getState().itemList.list).toHaveLength(1);
  });

  it("registers an ordinarily created custom item in the library", async () => {
    mockedCreateNewFreeForm.mockResolvedValue(
      createMockItem({
        name: "Welcome Slides",
        _id: "welcome-slides",
        type: "free",
        background: "welcome-background",
        slides: [{ id: "slide-1" }] as ItemState["slides"],
      }),
    );
    const store = createTestStore({
      createItem: {
        ...initialCreateItemState,
        type: "free",
        hasUserSelectedType: true,
        name: "Welcome Slides",
        text: "Welcome",
      },
    });

    renderCreateItem({ store });
    fireEvent.click(screen.getByRole("button", { name: "Create Custom Item" }));

    await waitFor(() => {
      expect(store.getState().allItems.list).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _id: "welcome-slides",
            name: "Welcome Slides",
            type: "free",
          }),
        ]),
      );
    });
    expect(store.getState().allItems.list).toHaveLength(1);
  });

  it("navigates to the inserted outline row listId after creating a song", async () => {
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
      expect(screen.getByTestId("item-page")).toBeInTheDocument();
    });

    const insertedListId = store.getState().itemList.list[0].listId;
    expect(screen.getByTestId("item-page")).toHaveTextContent(
      `${window.btoa(encodeURI("song-1"))}:${window.btoa(
        encodeURI(insertedListId),
      )}`,
    );
  });

  it("imports Genius lyrics into the song draft and passes song metadata to createNewSong", async () => {
    mockedResolveLrclibImport.mockResolvedValue({
      match: {
        source: "genius",
        geniusId: 17,
        geniusUrl: "https://genius.com/amazing-grace-lyrics",
        trackName: "Amazing Grace",
        artistName: "Traditional",
        albumName: "Hymns",
        plainLyrics: "Amazing grace",
        syncedLyrics: null,
      },
      candidates: [],
    });
    mockedCreateNewSong.mockResolvedValue(
      createMockItem({
        name: "Amazing Grace",
        _id: "song-17",
        type: "song",
      }),
    );

    const store = createTestStore({
      createItem: {
        ...initialCreateItemState,
        name: "Amazing Grace",
      },
    });

    renderCreateItem({ store });

    fireEvent.click(screen.getByRole("button", { name: "Import Lyrics" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Lyrics:")).toHaveValue(
        "Amazing grace",
      );
    });

    expect(store.getState().createItem.songMetadata).toEqual(
      expect.objectContaining({
        source: "genius",
        geniusId: 17,
        trackName: "Amazing Grace",
        artistName: "Traditional",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create Song" }));

    await waitFor(() => {
      expect(mockedCreateNewSong).toHaveBeenCalledWith(
        expect.objectContaining({
          songMetadata: expect.objectContaining({
            source: "genius",
            geniusId: 17,
          }),
        }),
      );
    });
  });

  it("opens full lyrics in a drawer when import returns multiple candidates", async () => {
    mockedResolveLrclibImport.mockResolvedValue({
      match: null,
      candidates: [
        {
          source: "lrclib",
          lrclibId: 42,
          trackName: "Owe You Praise",
          artistName: "Elevation Worship",
          albumName: "Living Room Sessions",
          plainLyrics: "Verse 1\nLine one\nLine two\nBridge\nFinal line",
          syncedLyrics: null,
        },
      ],
    });

    const store = createTestStore({
      createItem: {
        ...initialCreateItemState,
        name: "Owe You Praise",
      },
    });

    renderCreateItem({ store });

    fireEvent.click(screen.getByRole("button", { name: "Import Lyrics" }));

    await waitFor(() => {
      expect(screen.getByText("Choose song")).toBeInTheDocument();
    });

    let resolveSecondImport: (
      value: Awaited<ReturnType<typeof resolveLrclibImport>>,
    ) => void = () => undefined;
    const secondImport = new Promise<
      Awaited<ReturnType<typeof resolveLrclibImport>>
    >((resolve) => {
      resolveSecondImport = resolve;
    });
    mockedResolveLrclibImport.mockReturnValueOnce(secondImport);

    fireEvent.click(screen.getByRole("button", { name: "Import Lyrics" }));

    expect(
      screen.getByRole("status", { name: "Loading lyrics results" }),
    ).toHaveTextContent("Searching for lyrics...");
    expect(
      screen.queryByRole("button", { name: "Use Lyrics" }),
    ).not.toBeInTheDocument();

    resolveSecondImport({
      match: null,
      candidates: [
        {
          source: "lrclib",
          lrclibId: 42,
          trackName: "Owe You Praise",
          artistName: "Elevation Worship",
          albumName: "Living Room Sessions",
          plainLyrics: "Verse 1\nLine one\nLine two\nBridge\nFinal line",
          syncedLyrics: null,
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Use Lyrics" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Expand preview" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View lyrics" }));

    expect(
      screen.getByRole("heading", { name: "Lyrics — Owe You Praise" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Bridge").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Use Lyrics" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Lyrics:")).toHaveValue(
        "Verse 1\nLine one\nLine two\nBridge\nFinal line",
      );
    });
  });

  it("keeps successful Genius candidates when another local page hydration fails", async () => {
    const successfulCandidate = {
      source: "genius" as const,
      geniusId: 31,
      geniusUrl: "https://genius.com/successful-song-lyrics",
      trackName: "Successful Song",
      artistName: "Example Artist",
      plainLyrics: null,
      syncedLyrics: null,
    };
    const failedCandidate = {
      source: "genius" as const,
      geniusId: 32,
      geniusUrl: "https://genius.com/failed-song-lyrics",
      trackName: "Failed Song",
      artistName: "Example Artist",
      plainLyrics: null,
      syncedLyrics: null,
    };
    mockedResolveLrclibImport.mockResolvedValue({
      match: null,
      candidates: [successfulCandidate, failedCandidate],
    });
    let resolveSuccessfulHydration: (
      candidate: NormalizedLrclibTrack,
    ) => void = () => undefined;
    const successfulHydration = new Promise<NormalizedLrclibTrack>(
      (resolve) => {
        resolveSuccessfulHydration = resolve;
      },
    );
    mockedFetchGeniusLyricsLocally
      .mockReturnValueOnce(successfulHydration)
      .mockRejectedValueOnce(new Error("Genius page unavailable"));

    const store = createTestStore({
      createItem: {
        ...initialCreateItemState,
        name: "Example Song",
      },
    });

    renderCreateItem({ store });
    fireEvent.click(screen.getByRole("button", { name: "Import Lyrics" }));

    await waitFor(() => {
      expect(screen.getByText("Successful Song")).toBeInTheDocument();
    });
    expect(screen.getByText("Failed Song")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Use Lyrics" })).toHaveLength(2);
    expect(screen.getByText("Lyrics loading from Genius...")).toBeInTheDocument();
    expect(
      screen.getByText("Genius lyrics are unavailable for this result."),
    ).toBeInTheDocument();

    resolveSuccessfulHydration({
      ...successfulCandidate,
      plainLyrics: "Successful lyrics",
    });

    await waitFor(() => {
      expect(store.getState().createItem.lyricsImportCandidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            geniusId: 31,
            plainLyrics: "Successful lyrics",
          }),
          expect.objectContaining({ geniusId: 32, plainLyrics: null }),
        ]),
      );
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

  it("requires explicit separate creation when another song with the same name exists", async () => {
    mockedCreateNewSong.mockResolvedValue(
      createMockItem({
        name: "Amazing Grace",
        _id: "song-2",
        type: "song",
      }),
    );

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

    const createButton = screen.getByRole("button", { name: "Create Song" });
    expect(createButton).toBeEnabled();

    fireEvent.click(createButton);

    // The requested duplicate safeguard now requires an explicit separate create.
    expect(mockedCreateNewSong).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create separate song" }));

    await waitFor(() => {
      expect(mockedCreateNewSong).toHaveBeenCalled();
    });
  });

  it("shows an existing song without controller actions when an embedded caller has no attachment callback", () => {
    const store = createTestStore({
      createItem: {
        ...initialCreateItemState,
        name: "Amazing Grace",
      },
      allSongDocs: [
        createMockItem({
          _id: "existing-song",
          name: "Amazing Grace",
          type: "song",
        }),
      ],
    });

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={createMockControllerContext() as any}>
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <MemoryRouter>
              <CreateItem variant="embedded" />
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    expect(
      screen.getByText(/A song named “Amazing Grace” already exists\./),
    ).toBeInTheDocument();
    const draftBefore = store.getState().createItem;
    fireEvent.click(screen.getByRole("button", { name: "Create and attach" }));
    expect(screen.getByRole("region", { name: "Possible duplicate songs" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Amazing Grace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach Amazing Grace" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Return to editing" }));
    expect(store.getState().createItem).toEqual(draftBefore);
    expect(mockedCreateNewSong).not.toHaveBeenCalled();
  });

  it("waits for the shared item index before embedded song creation", () => {
    const store = createTestStore({
      createItem: {
        ...initialCreateItemState,
        name: "New Song",
      },
      isAllItemsInitialized: false,
    });

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={createMockControllerContext() as any}>
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <MemoryRouter>
              <CreateItem variant="embedded" />
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Song library is still connecting.",
    );
    expect(
      screen.getByRole("button", { name: /Create and attach/i }),
    ).toBeDisabled();
  });

  it("creates a custom document from the embedded form and returns it to the caller", async () => {
    const createdDocument = createMockItem({
      _id: "new-document",
      name: "Prayer Guide",
      type: "free",
    });
    mockedCreateNewFreeForm.mockResolvedValue(createdDocument);
    const onCreated = jest.fn();
    const store = createTestStore({
      createItem: {
        ...initialCreateItemState,
        type: "free",
        hasUserSelectedType: true,
      },
    });

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={createMockControllerContext() as any}>
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <MemoryRouter>
              <CreateItem variant="embedded" embeddedType="free" onCreated={onCreated} />
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    expect(screen.getByLabelText("Item Name:")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Item Name:"), {
      target: { value: "Prayer Guide" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create and attach" }));

    await waitFor(() => expect(mockedCreateNewFreeForm).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Prayer Guide" }),
    ));
    expect(onCreated).toHaveBeenCalledWith(createdDocument);
  });

  it("keeps custom-document creation pending and ignores duplicate activation", async () => {
    const createdDocument = createMockItem({
      _id: "new-document",
      name: "Prayer Guide",
      type: "free",
    });
    let resolveCreate!: (item: ItemState) => void;
    mockedCreateNewFreeForm.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const onCreated = jest.fn();
    const store = createTestStore({
      createItem: {
        ...initialCreateItemState,
        name: "Prayer Guide",
        type: "free",
        hasUserSelectedType: true,
      },
    });

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={createMockControllerContext() as any}>
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <MemoryRouter>
              <CreateItem variant="embedded" embeddedType="free" onCreated={onCreated} />
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    const createButton = screen.getByRole("button", { name: "Create and attach" });
    fireEvent.click(createButton);
    fireEvent.click(createButton);

    expect(mockedCreateNewFreeForm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled();

    await act(async () => resolveCreate(createdDocument));
    expect(onCreated).toHaveBeenCalledWith(createdDocument);
  });

  it("allows retry after custom-document creation fails", async () => {
    const createdDocument = createMockItem({
      _id: "new-document",
      name: "Prayer Guide",
      type: "free",
    });
    mockedCreateNewFreeForm
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(createdDocument);
    const onCreated = jest.fn();
    const store = createTestStore({
      createItem: {
        ...initialCreateItemState,
        name: "Prayer Guide",
        type: "free",
        hasUserSelectedType: true,
      },
    });

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={createMockControllerContext() as any}>
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <MemoryRouter>
              <CreateItem variant="embedded" embeddedType="free" onCreated={onCreated} />
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create and attach" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not create the custom document.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Create and attach" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdDocument));
    expect(mockedCreateNewFreeForm).toHaveBeenCalledTimes(2);
  });

  it("keeps the draft when navigating to Bible and back without creating", async () => {
    const store = createTestStore();
    const view = renderCreateItem({ store });

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

    view.unmount();
    renderCreateItem({ store });

    expect(screen.getByLabelText("Item Name:")).toHaveValue("John Reading");
    expect(screen.getByLabelText("Bible:")).toBeChecked();
  });

  it("reviews and applies TXT without saving, then creates using the existing song action", async () => {
    const user = userEvent.setup();
    mockedCreateNewSong.mockResolvedValue(createMockItem({ name: "TXT Song" }));
    const { store } = renderCreateItem();
    const file = new File(["lyrics"], "import.txt", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("Title: TXT Song\nArtist: Example\nVerse 1\nOriginal words!\nCCLI Song # 123\n© Example").buffer });
    await user.click(screen.getByRole("button", { name: "Import TXT" }));
    await user.upload(screen.getByLabelText("TXT song file"), file);
    expect(await screen.findByRole("region", { name: "Review TXT import" })).toBeInTheDocument();
    expect(store.getState().createItem.text).toBe("");
    expect(mockedCreateNewSong).not.toHaveBeenCalled();
    await user.click(screen.getByText("Formatted sections"));
    expect(await screen.findByText("Verse")).toBeInTheDocument();
    expect(screen.getByText("Original words!")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Imported song name:"));
    await user.type(screen.getByLabelText("Imported song name:"), "Reviewed Song");
    await user.click(screen.getByRole("button", { name: "Apply TXT to draft" }));
    expect(store.getState().createItem).toMatchObject({ name: "Reviewed Song", songArtist: "Example", text: "Verse 1\nOriginal words!", songMetadata: { ccliSongNumber: "123", copyright: "© Example" } });
    expect(mockedCreateNewSong).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Create Song" }));
    expect(mockedCreateNewSong).toHaveBeenCalledWith(expect.objectContaining({ name: "Reviewed Song", songMetadata: expect.objectContaining({ ccliSongNumber: "123", trackName: "Reviewed Song" }) }));
  });

  it("leaves an existing draft intact on cancel and requires confirmation to replace it", async () => {
    const user = userEvent.setup();
    const store = createTestStore({ createItem: { ...initialCreateItemState, name: "My draft", text: "My words" } });
    renderCreateItem({ store });
    const file = new File(["Lyrics"], "new.txt", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("New lyrics").buffer });
    await user.upload(screen.getByLabelText("TXT song file"), file);
    await user.click(await screen.findByRole("button", { name: "Apply TXT to draft" }));
    expect(store.getState().createItem.text).toBe("My words");
    await user.click(screen.getByRole("button", { name: "Cancel TXT import" }));
    expect(store.getState().createItem.text).toBe("My words");
    await user.upload(screen.getByLabelText("TXT song file"), file);
    await user.click(await screen.findByRole("button", { name: "Apply TXT to draft" }));
    await user.click(screen.getByRole("button", { name: "Replace current draft with TXT" }));
    expect(store.getState().createItem.text).toBe("New lyrics");
    expect(mockedCreateNewSong).not.toHaveBeenCalled();
  });

  it("detects a CCLI duplicate with a different title and allows opening or returning to editing", async () => {
    const user = userEvent.setup();
    const store = createTestStore({ createItem: { ...initialCreateItemState, name: "Another title", text: "Words", songMetadata: { source: "manual", trackName: "Another title", artistName: "", importedAt: "", ccliSongNumber: "123" } }, allSongDocs: [createMockItem({ _id: "existing", name: "Library title", songMetadata: { source: "manual", trackName: "Library title", artistName: "", importedAt: "", ccliSongNumber: "123" } })] });
    renderCreateItem({ store });
    await user.click(screen.getByRole("button", { name: "Create Song" }));
    expect(screen.getByRole("button", { name: "Open Library title" })).toBeInTheDocument();
    expect(mockedCreateNewSong).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Return to editing" }));
    expect(screen.queryByRole("region", { name: "Possible duplicate songs" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create Song" }));
    await user.click(screen.getByRole("button", { name: "Open Library title" }));
    expect(await screen.findByTestId("item-page")).toBeInTheDocument();
    expect(mockedCreateNewSong).not.toHaveBeenCalled();
  });

  it("discards a pending TXT read when the draft is reset", async () => {
    const user = userEvent.setup();
    const { store } = renderCreateItem();
    let finish!: (value: ArrayBuffer) => void;
    const file = new File(["Lyrics"], "old.txt", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", { value: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) });
    await user.upload(screen.getByLabelText("TXT song file"), file);
    expect(screen.getByRole("button", { name: "Reading TXT..." })).toBeDisabled();
    act(() => { store.dispatch(createItemSlice.actions.resetCreateItem()); });
    await act(async () => finish(new TextEncoder().encode("Old lyrics").buffer));
    expect(screen.queryByRole("region", { name: "Review TXT import" })).not.toBeInTheDocument();
    expect(store.getState().createItem.text).toBe("");
  });

  it("cancels a pending TXT read and ignores its late result", async () => {
    const user = userEvent.setup();
    const { store } = renderCreateItem();
    let finish!: (value: ArrayBuffer) => void;
    const file = new File(["Lyrics"], "old.txt", { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", { value: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) });
    await user.upload(screen.getByLabelText("TXT song file"), file);
    await user.click(screen.getByRole("button", { name: "Cancel TXT import" }));
    await act(async () => finish(new TextEncoder().encode("Old lyrics").buffer));
    expect(screen.queryByRole("region", { name: "Review TXT import" })).not.toBeInTheDocument();
    expect(store.getState().createItem.text).toBe("");
  });

  it("keeps a newer draft intact when an older song creation finishes", async () => {
    const user = userEvent.setup();
    let finish!: (value: ItemState) => void;
    mockedCreateNewSong.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const store = createTestStore({ createItem: { ...initialCreateItemState, name: "Older song", text: "Words" } });
    renderCreateItem({ store });
    await user.click(screen.getByRole("button", { name: "Create Song" }));
    expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled();
    act(() => { store.dispatch(createItemSlice.actions.setCreateItem({ ...initialCreateItemState, name: "New draft" })); });
    await act(async () => finish(createMockItem({ name: "Older song" })));
    expect(store.getState().createItem.name).toBe("New draft");
    expect(store.getState().itemList.list).toHaveLength(0);
    expect(screen.queryByTestId("item-page")).not.toBeInTheDocument();
  });

  it("keeps a pending song write in its original database after a database switch", async () => {
    const user = userEvent.setup();
    let finish!: (value: { ok: boolean }) => void;
    const databaseA = {
      name: "church-a",
      get: jest.fn().mockRejectedValue(Object.assign(new Error("not found"), { status: 404 })),
      put: jest.fn(() => new Promise(resolve => { finish = resolve; })),
    };
    const databaseB = { name: "church-b", get: jest.fn(), put: jest.fn() };
    mockedCreateNewSong.mockImplementation(jest.requireActual("../../utils/itemUtil").createNewSong);
    const store = createTestStore({ createItem: { ...initialCreateItemState, name: "Song", text: "Words" } });
    const surface = (database: unknown) => <Provider store={store}>
      <ControllerInfoContext.Provider value={createMockControllerContext({ db: database as PouchDB.Database }) as any}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <MemoryRouter><CreateItem /></MemoryRouter>
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>
    </Provider>;
    const { rerender } = render(surface(databaseA));
    await user.click(screen.getByRole("button", { name: "Create Song" }));
    await waitFor(() => expect(databaseA.put).toHaveBeenCalledTimes(1));
    rerender(surface(databaseB));
    await act(async () => finish({ ok: true }));
    expect(databaseB.get).not.toHaveBeenCalled();
    expect(databaseB.put).not.toHaveBeenCalled();
    expect(store.getState().createItem.name).toBe("Song");
    expect(store.getState().allDocs.allSongDocs).toHaveLength(0);
  });

  it("does not publish a song creation after its form unmounts", async () => {
    const user = userEvent.setup();
    let finish!: (value: ItemState) => void;
    mockedCreateNewSong.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const store = createTestStore({ createItem: { ...initialCreateItemState, name: "Song", text: "Words" } });
    const { unmount } = renderCreateItem({ store });
    await user.click(screen.getByRole("button", { name: "Create Song" }));
    unmount();
    await act(async () => finish(createMockItem({ name: "Song" })));
    expect(store.getState().createItem.name).toBe("Song");
    expect(store.getState().itemList.list).toHaveLength(0);
    expect(store.getState().allDocs.allSongDocs).toHaveLength(0);
  });

  it("shows remove-ad-libs toggle for songs without opening Advanced", () => {
    renderCreateItem();

    expect(
      screen.getByLabelText("Remove ad-libs in parentheses:"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Sends to:")).not.toBeInTheDocument();
  });

  it("keeps Sends to behind the Advanced toggle", () => {
    renderCreateItem();

    expect(screen.queryByText("Sends to:")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

    expect(screen.getByText("Sends to:")).toBeInTheDocument();
  });

  it("strips parenthetical phrases from lyrics on create when the option is enabled", async () => {
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
        text: "Praises (Only You)",
      },
    });

    renderCreateItem({ store });

    fireEvent.click(screen.getByLabelText("Remove ad-libs in parentheses:"));
    fireEvent.click(screen.getByRole("button", { name: "Create Song" }));

    await waitFor(() => {
      expect(mockedCreateNewSong).toHaveBeenCalled();
    });

    const formattedLyrics = mockedCreateNewSong.mock.calls[0][0].formattedLyrics;
    expect(formattedLyrics.some((lyric) => lyric.words.includes("("))).toBe(
      false,
    );
    expect(formattedLyrics[0].words).toBe("Praises");
  });
});
