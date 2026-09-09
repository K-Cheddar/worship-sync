import { fireEvent, render, screen } from "@testing-library/react";
import ItemSlides from "./ItemSlides";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";

const mockDispatch = jest.fn();
let mockState: any;

const mockEnsureSlidesHaveMonitorBandFormatting = jest.fn((slides: any[]) =>
  slides.map((slide, index) => ({
    ...slide,
    monitorCurrentBandBoxes: [
      {
        id: `current-band-${index}`,
        words: `current-band-${index}`,
        width: 100,
        height: 50,
      },
    ],
    monitorNextBandBoxes: [
      {
        id: `next-band-${index}`,
        words: `normalized-next-${index}`,
        width: 100,
        height: 50,
        monitorFontSizePx: 72,
      },
    ],
  })),
);

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

jest.mock("../../utils/overflow", () => {
  const actual = jest.requireActual("../../utils/overflow");
  return {
    __esModule: true,
    ...actual,
    ensureSlidesHaveMonitorBandFormatting: (slides: any[]) =>
      mockEnsureSlidesHaveMonitorBandFormatting(slides),
  };
});

jest.mock("../../components/Button/Button", () => ({
  __esModule: true,
  default: ({
    children,
    onClick,
    disabled,
    title,
    "aria-label": ariaLabel,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    "aria-label"?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  ),
}));

jest.mock("../../components/ErrorBoundary/ErrorBoundary", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("../../utils/dndUtils", () => ({
  useSensors: () => [],
}));

jest.mock("../../utils/generalUtils", () => ({
  keepElementInView: jest.fn(),
}));

jest.mock("./OutlineItemSlidesScroller", () => ({
  __esModule: true,
  default: ({ cols }: { cols: number }) => (
    <div data-testid="outline-scroller" data-cols={cols} />
  ),
}));

const mockNeighborDocs = new Map<string, unknown>();
jest.mock("../../hooks/useOutlineItemDocs", () => ({
  useOutlineItemDocs: () => mockNeighborDocs,
}));

jest.mock("../../context/activeController", () => {
  const actual = jest.requireActual("../../context/activeController");
  return {
    ...actual,
    useControllerBasePath: () => "/controller",
  };
});

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/controller/item/free-1/list-1" }),
  useNavigate: () => mockNavigate,
}));

jest.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDroppable: () => ({ setNodeRef: jest.fn() }),
}));

jest.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  rectSortingStrategy: {},
}));

jest.mock("./ItemSlide", () => ({
  __esModule: true,
  default: ({
    index,
    slide,
    selectSlide,
  }: {
    index: number;
    slide: { name: string };
    selectSlide: (index: number) => void;
  }) => (
    <button type="button" onClick={() => selectSlide(index)}>
      {slide.name}
    </button>
  ),
}));

const baseSlides = [
  {
    id: "slide-1",
    type: "Section",
    name: "Section 1",
    boxes: [
      { id: "bg-1", width: 100, height: 100 },
      { id: "text-1", words: "Current", width: 100, height: 50 },
    ],
  },
  {
    id: "slide-2",
    type: "Section",
    name: "Section 2",
    boxes: [
      { id: "bg-2", width: 100, height: 100 },
      { id: "text-2", words: "Raw next slide", width: 100, height: 50 },
    ],
  },
];

const mockGlobalInfoValue = {
  access: "full",
} as unknown as React.ContextType<typeof GlobalInfoContext>;

const mockControllerInfoValue = {
  isMobile: false,
} as unknown as React.ContextType<typeof ControllerInfoContext>;

describe("ItemSlides", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNeighborDocs.clear();
    Object.defineProperty(window, "requestAnimationFrame", {
      writable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      },
    });

    mockState = {
      undoable: {
        present: {
          item: {
            arrangements: [],
            selectedArrangement: 0,
            selectedSlide: 0,
            type: "free",
            name: "Custom Item",
            slides: baseSlides,
            isLoading: false,
            _id: "free-1",
            listId: "list-1",
            shouldSendTo: {
              monitor: true,
              projector: false,
              stream: false,
            },
            isEditMode: false,
          },
          itemList: {
            selectedItemListId: "list-1",
            list: [
              {
                _id: "free-1",
                listId: "list-1",
                name: "Custom Item",
                type: "free",
              },
              {
                _id: "song-2",
                listId: "list-2",
                name: "Next Song",
                type: "song",
              },
            ],
          },
          preferences: {
            slidesPerRow: 3,
            slidesPerRowMobile: 2,
            shouldShowStreamFormat: false,
            shouldShowItemEditor: true,
            monitorSettings: {
              showNextSlide: true,
            },
          },
        },
      },
      presentation: {
        isMonitorTransmitting: false,
        isProjectorTransmitting: false,
        isStreamTransmitting: false,
        streamItemContentBlocked: false,
        prevProjectorInfo: {
          type: "",
          name: "",
          slide: null,
          displayType: "projector",
        },
        prevMonitorInfo: {
          type: "",
          name: "",
          slide: null,
          nextSlide: null,
          displayType: "monitor",
        },
        prevStreamInfo: { type: "", name: "", slide: null, displayType: "stream" },
        projectorInfo: {
          type: "",
          name: "",
          slide: null,
          displayType: "projector",
        },
        monitorInfo: {
          type: "",
          name: "",
          slide: null,
          nextSlide: null,
          displayType: "monitor",
        },
        streamInfo: {
          type: "",
          name: "",
          slide: null,
          displayType: "stream",
        },
      },
      timers: {
        timers: [],
      },
      allDocs: {
        allSongDocs: [],
        allFreeFormDocs: [],
        allTimerDocs: [],
        allBibleDocs: [],
      },
    };
  });

  it("sends monitor-band next boxes for free items when next-slide view is enabled", () => {
    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Section 1" }));

    const updateMonitorAction = mockDispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action?.type === "presentation/updateMonitor");

    expect(mockEnsureSlidesHaveMonitorBandFormatting).toHaveBeenCalledWith(
      baseSlides,
    );
    expect(updateMonitorAction).toBeDefined();
    expect(updateMonitorAction.payload.nextSlide.boxes).toEqual([
      expect.objectContaining({
        id: "next-band-1",
        words: "normalized-next-1",
        monitorFontSizePx: 72,
      }),
    ]);
    expect(updateMonitorAction.payload.nextSlide.boxes).not.toEqual(
      baseSlides[1].boxes,
    );
  });

  it("clears the monitor timer when sending a service-time item", () => {
    mockState.undoable.present.item = {
      ...mockState.undoable.present.item,
      type: "service-time",
      name: "Upcoming Service",
    };

    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Section 1" }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "preferences/setMonitorTimerId",
        payload: null,
      }),
    );
  });

  it("moves to the next outline song with ArrowDown in continuous mode", () => {
    mockState.undoable.present.preferences.shouldShowItemEditor = false;
    mockNeighborDocs.set("song-2", {
      _id: "song-2",
      _rev: "1",
      name: "Next Song",
      type: "song",
      selectedArrangement: 0,
      arrangements: [
        {
          id: "arr-1",
          name: "Default",
          formattedLyrics: [],
          songOrder: [],
          slides: [
            {
              id: "title",
              name: "Title",
              type: "Title",
              boxes: [],
            },
            {
              id: "v1",
              name: "Verse 1",
              type: "Verse",
              boxes: [],
            },
          ],
        },
      ],
      slides: [],
      shouldSendTo: { projector: true, monitor: true, stream: true },
    });

    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "itemList/setActiveItemInList",
        payload: "list-2",
      }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "item/setActiveItem",
        payload: expect.objectContaining({
          _id: "song-2",
          listId: "list-2",
        }),
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining("/controller/item/"),
      { replace: true },
    );
  });

  it("does not change songs with ArrowDown when the item editor is open", () => {
    mockState.undoable.present.preferences.shouldShowItemEditor = true;

    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "itemList/setActiveItemInList",
        payload: "list-2",
      }),
    );
  });

  it("keeps zoom controls in continuous mode and hides edit controls", () => {
    mockState.undoable.present.preferences.shouldShowItemEditor = false;

    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(screen.getByTestId("outline-scroller")).toBeInTheDocument();
    expect(screen.getByLabelText("Slide thumbnail zoom")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear background" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("shows clear background and delete in the main action bar without subset selection", () => {
    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear background" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
  });

  it("clears the focused slide background without entering subset selection", () => {
    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    mockDispatch.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Clear background" }));

    // Async thunk: mock dispatch receives the thunk function.
    expect(mockDispatch).toHaveBeenCalledWith(expect.any(Function));
  });

  it("shows Done only while a slide subset is selected", () => {
    mockState.undoable.present.item.backgroundTargetSlideIds = ["slide-1"];
    mockState.undoable.present.item.mobileBackgroundTargetSelectMode = true;

    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(screen.getByText("slide selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    const actionButtons = screen
      .getAllByRole("button")
      .map((button) => button.textContent?.trim())
      .filter((label): label is string =>
        Boolean(
          label &&
          ["Done", "Add", "Copy", "Clear background", "Delete"].includes(
            label,
          ),
        ),
      );
    expect(actionButtons[0]).toBe("Done");
    expect(
      screen.getByRole("button", { name: "Clear background" }),
    ).toBeInTheDocument();
  });

  it("shows clear background without add/copy/delete for song items", () => {
    mockState.undoable.present.item = {
      ...mockState.undoable.present.item,
      type: "song",
      name: "Song",
      _id: "song-2",
      listId: "list-2",
    };

    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear background" }),
    ).toBeInTheDocument();
  });

  it("does not clamp continuous-mode zoom when a service-time item is selected", () => {
    mockState.undoable.present.preferences.shouldShowItemEditor = false;
    mockState.undoable.present.preferences.slidesPerRow = 5;
    mockState.undoable.present.item = {
      ...mockState.undoable.present.item,
      type: "service-time",
      name: "11 AM Countdown",
      _id: "service-time-countdown",
      listId: "row-service-time",
    };

    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(screen.getByTestId("outline-scroller")).toHaveAttribute(
      "data-cols",
      "5",
    );
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuemax", "7");
  });

  it("still clamps zoom for timer-like items in single-item mode", () => {
    mockState.undoable.present.preferences.shouldShowItemEditor = true;
    mockState.undoable.present.preferences.slidesPerRow = 5;
    mockState.undoable.present.item = {
      ...mockState.undoable.present.item,
      type: "service-time",
      name: "11 AM Countdown",
      _id: "service-time-countdown",
      listId: "row-service-time",
    };

    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(screen.getByRole("list")).toHaveClass("grid-cols-3");
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuemax", "3");
  });
});
