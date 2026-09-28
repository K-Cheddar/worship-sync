import React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

import FilteredItems from "./FilteredItems";
import {
  FILTERED_ITEM_GRID_COLUMNS,
  FILTERED_SONG_GRID_COLUMNS,
} from "./FilteredItem";
import { createItemSlice, initialCreateItemState } from "../../store/createItemSlice";
import { createMockControllerContext, createMockGlobalContext } from "../../test/mocks";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { searchLrclibTracks } from "../../api/lrclib";
import { deleteSongAudioWithRetry } from "../../api/auth";
import { PresentationControllerModeProvider } from "../../context/presentationControllerMode";

jest.mock("../../api/lrclib", () => ({
  searchLrclibTracks: jest.fn(),
}));
jest.mock("../../api/auth", () => ({
  deleteSongAudioWithRetry: jest.fn(),
  getSongAudioUrl: jest.fn(),
  uploadSongAudio: jest.fn(),
}));

const mockedSearchLrclibTracks = searchLrclibTracks as jest.MockedFunction<
  typeof searchLrclibTracks
>;
const mockedDeleteSongAudio = deleteSongAudioWithRetry as jest.MockedFunction<
  typeof deleteSongAudioWithRetry
>;

const CreateRouteProbe = () => {
  const location = useLocation();
  return <div data-testid="route-path">{location.pathname}</div>;
};

const createTestStore = () =>
  configureStore({
    reducer: {
      createItem: createItemSlice.reducer,
    },
    preloadedState: {
      createItem: initialCreateItemState,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
        immutableCheck: false,
      }),
  });

describe("FilteredItems", () => {
  let getBoundingClientRectSpy: jest.SpyInstance;

  beforeEach(() => {
    mockedSearchLrclibTracks.mockReset();
    mockedDeleteSongAudio.mockReset();
    mockedDeleteSongAudio.mockResolvedValue({ success: true });
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
    window.localStorage.removeItem("worshipsync_presentation_controller_mode");
  });

  it.each([
    { type: "song", label: "song", name: "Song title" },
    { type: "free", label: "custom item", name: "Custom title" },
    { type: "timer", label: "timer", name: "Timer title" },
  ])("shows the type column and accessible $type icon", async ({ type, label, name }) => {
    const item = {
      _id: `${type}-1`,
      name,
      type,
      listId: `${type}-1`,
    } as any;

    render(
      <Provider store={createTestStore()}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext() as any}
        >
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <MemoryRouter>
              <FilteredItems
                list={[item]}
                type={type}
                heading={type}
                label={label}
                isLoading={false}
                allDocs={[]}
                searchValue=""
                setSearchValue={jest.fn()}
              />
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
    });
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Type")).toHaveClass("justify-self-center");
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: label })).toHaveAttribute(
      "title",
      label,
    );
    expect(screen.getByRole("img", { name: label })).toHaveClass(
      "justify-center",
    );
    expect(screen.getByTitle(name)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add to outline/i })).toBeInTheDocument();
  });

  it("keeps the type column fixed while songs show artist metadata below the name on narrow layouts", async () => {
    const song = {
      _id: "song-with-artist",
      name: "Song with artist",
      type: "song",
      listId: "song-with-artist",
    } as any;
    const songDoc = {
      ...song,
      songMetadata: { artistName: "Traditional" },
    } as any;

    render(
      <Provider store={createTestStore()}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext() as any}
        >
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <MemoryRouter>
              <FilteredItems
                list={[song]}
                type="song"
                heading="Songs"
                label="song"
                isLoading={false}
                allDocs={[songDoc]}
                searchValue=""
                setSearchValue={jest.fn()}
              />
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    expect(FILTERED_ITEM_GRID_COLUMNS).toContain("44px_minmax(0,1fr)_9rem");
    expect(FILTERED_ITEM_GRID_COLUMNS).toContain("md:grid-cols-[44px_minmax(0,1fr)_15rem]");
    expect(FILTERED_SONG_GRID_COLUMNS).toContain("44px_minmax(0,1fr)_9rem");
    expect(FILTERED_SONG_GRID_COLUMNS).toContain("13rem_21rem");
    await waitFor(() => {
      expect(screen.getByText("Traditional")).toBeInTheDocument();
    });
    expect(screen.getByRole("img", { name: "song" })).toHaveClass(
      "row-span-2",
      "md:row-span-1",
    );
  });

  it("keeps a readable fallback when song artist metadata is missing", async () => {
    const song = {
      _id: "song-without-artist",
      name: "Song without artist",
      type: "song",
      listId: "song-without-artist",
    } as any;

    render(
      <Provider store={createTestStore()}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext() as any}
        >
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <MemoryRouter>
              <FilteredItems
                list={[song]}
                type="song"
                heading="Songs"
                label="song"
                isLoading={false}
                allDocs={[]}
                searchValue=""
                setSearchValue={jest.fn()}
              />
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText("—")).toHaveAttribute("title", "No artist listed");
    });
  });

  it("keeps the type icon visible when a virtualized lyric match expands", async () => {
    const song = {
      _id: "song-lyric-match",
      name: "Song title",
      type: "song",
      listId: "song-lyric-match",
    } as any;
    const songDoc = {
      ...song,
      arrangements: [
        { formattedLyrics: [{ words: "The Lord is my shepherd" }] },
      ],
    } as any;

    render(
      <Provider store={createTestStore()}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext() as any}
        >
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <MemoryRouter>
              <FilteredItems
                list={[song]}
                type="song"
                heading="Songs"
                label="song"
                isLoading={false}
                allDocs={[songDoc]}
                searchValue="shepherd"
                setSearchValue={jest.fn()}
              />
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText("shepherd")).toBeInTheDocument();
    });
    expect(screen.getByRole("img", { name: "song" })).toBeInTheDocument();
  });

  it("removes an attached MP3 from storage after deleting its song document", async () => {
    const audio = {
      id: "audio-1",
      key: "churches/church-1/songs/song-1/audio-1.mp3",
      fileName: "reference.mp3",
      contentType: "audio/mpeg" as const,
      sizeBytes: 100,
      uploadedAt: "2026-08-06T00:00:00.000Z",
    };
    const song = {
      _id: "song-1",
      name: "Reference Song",
      type: "song",
      songAudio: audio,
    } as any;
    const remove = jest.fn().mockResolvedValue({ ok: true });
    const db = {
      get: jest.fn().mockResolvedValue(song),
      remove,
    } as any;

    render(
      <Provider store={createTestStore()}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext({ db }) as any}
        >
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <MemoryRouter>
              <FilteredItems
                list={[song]}
                type="song"
                heading="Songs"
                label="song"
                isLoading={false}
                allDocs={[song]}
                searchValue=""
                setSearchValue={jest.fn()}
              />
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Delete Reference Song" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Delete Forever" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(song));
    expect(mockedDeleteSongAudio).toHaveBeenCalledWith({
      churchId: "church-1",
      songId: "song-1",
      audio,
    });
  });

  it("hides library delete controls in controller present mode", async () => {
    window.localStorage.setItem("worshipsync_presentation_controller_mode", "present");
    const item = {
      _id: "custom-1",
      name: "Welcome Slides",
      type: "free",
      listId: "custom-1",
    } as any;

    render(
      <Provider store={createTestStore()}>
        <ControllerInfoContext.Provider
          value={createMockControllerContext() as any}
        >
          <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
            <PresentationControllerModeProvider>
              <MemoryRouter>
                <FilteredItems
                  list={[item]}
                  type="free"
                  heading="Custom"
                  label="custom item"
                  isLoading={false}
                  allDocs={[]}
                  searchValue=""
                  setSearchValue={jest.fn()}
                />
              </MemoryRouter>
            </PresentationControllerModeProvider>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add to outline/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Delete Welcome Slides" })).not.toBeInTheDocument();
  });

  it("searches external lyrics and opens a prefilled create song draft", async () => {
    mockedSearchLrclibTracks.mockResolvedValue([
      {
        source: "genius",
        geniusId: 51,
        geniusUrl: "https://genius.com/example-song-lyrics",
        trackName: "Amazing Grace",
        artistName: "Traditional",
        albumName: "Hymns",
        plainLyrics:
          "Verse 1\nLine one\nLine two\nVerse 2\nLine four\nLine five\nAmazing grace, how sweet the sound\nLine after\nBridge\nFinal line",
        syncedLyrics: null,
      },
    ]);

    const store = createTestStore();
    const controllerContext = createMockControllerContext();
    const globalContext = createMockGlobalContext();

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={controllerContext as any}>
          <GlobalInfoContext.Provider value={globalContext as any}>
            <MemoryRouter initialEntries={["/controller/songs"]}>
              <Routes>
                <Route
                  path="/controller/songs"
                  element={
                    <FilteredItems
                      list={[]}
                      type="song"
                      heading="Songs"
                      label="song"
                      isLoading={false}
                      allDocs={[]}
                      searchValue="Amazing grace"
                      setSearchValue={jest.fn()}
                    />
                  }
                />
                <Route path="/controller/create" element={<CreateRouteProbe />} />
              </Routes>
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Search external lyrics" }),
    );

    expect(screen.getByText("Searching external lyrics...")).toBeInTheDocument();
    expect(screen.queryByText("External lyrics")).not.toBeInTheDocument();
    expect(screen.queryByText("End of search results")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Create song" }),
      ).toBeInTheDocument();
    });

    expect(screen.getAllByText("Amazing").length).toBeGreaterThan(0);
    expect(screen.queryByText("Verse 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View lyrics" }));

    expect(
      screen.getByRole("heading", { name: "Lyrics — Amazing Grace" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Verse").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Create song" }));

    await waitFor(() => {
      expect(screen.getByTestId("route-path")).toHaveTextContent("/controller/create");
    });

    expect(store.getState().createItem).toEqual(
      expect.objectContaining({
        name: "Amazing Grace",
        type: "song",
        text:
          "Verse 1\nLine one\nLine two\nVerse 2\nLine four\nLine five\nAmazing grace, how sweet the sound\nLine after\nBridge\nFinal line",
        songArtist: "Traditional",
        songAlbum: "Hymns",
        lyricsImportCandidates: [],
        lyricsImportError: "",
        songMetadata: expect.objectContaining({
          source: "genius",
          geniusId: 51,
          geniusUrl: "https://genius.com/example-song-lyrics",
          trackName: "Amazing Grace",
          artistName: "Traditional",
          albumName: "Hymns",
          plainLyrics:
            "Verse 1\nLine one\nLine two\nVerse 2\nLine four\nLine five\nAmazing grace, how sweet the sound\nLine after\nBridge\nFinal line",
          syncedLyrics: null,
          importedAt: expect.any(String),
        }),
      }),
    );
  });

  it("supports attach mode without outline add, delete, or external lyrics chrome", async () => {
    const onAddItem = jest.fn();
    const store = createTestStore();
    const controllerContext = createMockControllerContext();
    const globalContext = createMockGlobalContext();

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={controllerContext as any}>
          <GlobalInfoContext.Provider value={globalContext as any}>
            <MemoryRouter>
              <FilteredItems
                list={[
                  {
                    _id: "song-1",
                    name: "Living Hope",
                    type: "song",
                    listId: "song-1",
                    background: "",
                  },
                ]}
                type="song"
                heading="Songs"
                label="song"
                isLoading={false}
                allDocs={[
                  {
                    _id: "song-1",
                    name: "Living Hope",
                    type: "song",
                    arrangements: [
                      {
                        name: "Default",
                        formattedLyrics: [
                          { name: "Verse 1", words: "How great the chasm" },
                        ],
                      },
                    ],
                  } as never,
                ]}
                searchValue=""
                setSearchValue={jest.fn()}
                onAddItem={onAddItem}
                addButtonLabel="Attach"
                showDelete={false}
                showCreateAndExternal={false}
                hideHeading
              />
            </MemoryRouter>
          </GlobalInfoContext.Provider>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Attach$/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /Add to outline/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Search external lyrics/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Create a new song/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /View song details/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Attach$/i }));

    expect(onAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "song-1",
        name: "Living Hope",
        type: "song",
      }),
    );
  });
});
