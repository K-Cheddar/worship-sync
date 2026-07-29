import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ServicePlanLibraryPicker from "./ServicePlanLibraryPicker";
import { createNewSong } from "../../utils/itemUtil";
import { createMockControllerContext, createMockGlobalContext } from "../../test/mocks";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";

const mockDispatch = jest.fn();

const mockSelectorState = {
  allDocs: {
    allSongDocs: [
      {
        _id: "song-1",
        name: "Living Hope",
        type: "song",
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
        type: "song",
        arrangements: [
          {
            name: "Default",
            formattedLyrics: [
              { name: "Verse 1", words: "You give life, You are love" },
            ],
          },
        ],
      },
    ],
  },
  allItems: {
    isAllItemsLoading: false,
    list: [
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
    ],
  },
};

jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector(mockSelectorState),
  useDispatch: () => mockDispatch,
}));

jest.mock("../../utils/itemUtil", () => ({
  createNewSong: jest.fn(),
  createSections: jest.fn(() => ({ formattedLyrics: [], songOrder: [] })),
  updateFormattedSections: jest.fn(() => ({ formattedLyrics: [], songOrder: [] })),
}));

const mockCreateNewSong = jest.mocked(createNewSong);

const songTitleMatcher = (name: string) => (_: string, element: Element | null) => {
  if (!element || element.tagName.toLowerCase() !== "p") return false;
  // HighlightWords renders each word in its own span with no whitespace text nodes,
  // so "Living Hope" becomes textContent "LivingHope".
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

const renderPicker = () => {
  const onSelectSong = jest.fn();
  render(
    <MemoryRouter>
      <ControllerInfoContext.Provider value={createMockControllerContext() as never}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as never}>
          <ServicePlanLibraryPicker
            isOpen
            onClose={jest.fn()}
            onSelectSong={onSelectSong}
          />
        </GlobalInfoContext.Provider>
      </ControllerInfoContext.Provider>
    </MemoryRouter>,
  );
  return { onSelectSong };
};

describe("ServicePlanLibraryPicker", () => {
  let getBoundingClientRectSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectorState.allItems.isAllItemsLoading = false;
    mockSelectorState.allItems.list = [
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
    mockCreateNewSong.mockResolvedValue({
      _id: "song-new",
      name: "Brand New Song",
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
    mockSelectorState.allItems.isAllItemsLoading = true;
    mockSelectorState.allItems.list = [];
    renderPicker();

    await waitFor(() => {
      expect(screen.getByText(songTitleMatcher("Living Hope"))).toBeInTheDocument();
    });
    expect(screen.queryByText(/Songs are loading/i)).not.toBeInTheDocument();
  });

  it("shows View lyrics and hides outline/create/external chrome", async () => {
    renderPicker();

    await waitFor(() => {
      expect(screen.getByText(songTitleMatcher("Living Hope"))).toBeInTheDocument();
    });

    expect(screen.getAllByRole("button", { name: /View lyrics/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Add to outline/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Search external lyrics/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Create a new song/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create a new song/i })).toBeInTheDocument();
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

  it("creates a new library song through the Controller's pipeline and attaches it", async () => {
    const user = userEvent.setup();
    const { onSelectSong } = renderPicker();

    await user.click(screen.getByRole("button", { name: /Create a new song/i }));
    await user.type(screen.getByLabelText(/Song title/i), "Brand New Song");
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
});
