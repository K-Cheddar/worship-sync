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
import { createItemSlice, initialCreateItemState } from "../../store/createItemSlice";
import { createMockControllerContext, createMockGlobalContext } from "../../test/mocks";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { searchLrclibTracks } from "../../api/lrclib";

jest.mock("../../api/lrclib", () => ({
  searchLrclibTracks: jest.fn(),
}));

const mockedSearchLrclibTracks = searchLrclibTracks as jest.MockedFunction<
  typeof searchLrclibTracks
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
});
