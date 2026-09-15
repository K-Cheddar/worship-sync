import { act, fireEvent, render, screen } from "@testing-library/react";
import ItemSlides, { ItemSlidesDndContext } from "./ItemSlides";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { PresentationControllerModeProvider } from "../../context/presentationControllerMode";

const mockDispatch = jest.fn();
const mockDndContext = jest.fn();
const mockDndMonitor = jest.fn();
let mockDndMonitorListener: {
  onDragStart?: (event: unknown) => void;
  onDragOver?: (event: unknown) => void;
  onDragEnd?: (event: unknown) => void;
  onDragCancel?: () => void;
} | null = null;
let mockDndState: { active: unknown; over: unknown } = {
  active: null,
  over: null,
};
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
  DndContext: ({ children, ...props }: { children: React.ReactNode }) => {
    mockDndContext(props);
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDndMonitor: (listener: typeof mockDndMonitorListener) => {
    mockDndMonitor(listener);
    mockDndMonitorListener = listener;
  },
  useDndContext: () => mockDndState,
  useDroppable: () => ({ setNodeRef: jest.fn() }),
}));

jest.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
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

const mediaItems = [
  { id: "media-1", name: "One", type: "image", background: "one.jpg" },
  { id: "media-2", name: "Two", type: "image", background: "two.jpg" },
] as any[];

const mockGlobalInfoValue = {
  access: "full",
} as unknown as React.ContextType<typeof GlobalInfoContext>;

const mockControllerInfoValue = {
  isMobile: false,
} as unknown as React.ContextType<typeof ControllerInfoContext>;

describe("ItemSlides", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDndMonitorListener = null;
    mockDndState = { active: null, over: null };
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
            isLyricsEditorOpen: false,
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
        prevStreamInfo: {
          type: "",
          name: "",
          slide: null,
          displayType: "stream",
        },
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
      media: {
        list: mediaItems,
      },
      allDocs: {
        allSongDocs: [],
        allFreeFormDocs: [],
        allTimerDocs: [],
        allBibleDocs: [],
      },
    };
  });

  const renderAncestorItemSlides = (access = "full") => {
    return render(
      <GlobalInfoContext.Provider value={{ access } as any}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlidesDndContext.Provider value="ancestor">
            <ItemSlides />
          </ItemSlidesDndContext.Provider>
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );
  };

  const dropMediaAt = async (
    index: number,
    mediaIds: string[],
    target: "slide-insert" | "slide-container" | null = "slide-insert",
  ) => {
    mockDispatch.mockClear();
    renderAncestorItemSlides();
    act(() => {
      mockDndMonitorListener?.onDragEnd?.({
        active: {
          id: `media-${mediaIds[0]}`,
          data: { current: { kind: "media", mediaIds } },
        },
        over: target
          ? {
              id:
                target === "slide-insert"
                  ? `slide-insert-${index}`
                  : "item-slides-list",
              data: {
                current:
                  target === "slide-insert"
                    ? { kind: "slide-insert", index }
                    : { kind: "slide-container" },
              },
            }
          : null,
      });
    });
    const updateThunk = mockDispatch.mock.calls
      .map(([action]) => action)
      .find((action) => typeof action === "function");
    if (typeof updateThunk !== "function") return undefined;
    await act(async () => {
      await updateThunk(mockDispatch, () => mockState, undefined);
    });
    return mockDispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action?.type === "item/_updateSlides");
  };

  it("uses its local DndContext when no ancestor owns it", () => {
    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(mockDndContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sensors: [],
        collisionDetection: expect.any(Function),
      }),
    );
  });

  it("uses an ancestor DndContext for the main controller", () => {
    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlidesDndContext.Provider value="ancestor">
            <ItemSlides />
          </ItemSlidesDndContext.Provider>
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(mockDndContext).not.toHaveBeenCalled();
    expect(mockDndMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        onDragStart: expect.any(Function),
        onDragEnd: expect.any(Function),
      }),
    );
  });

  it("uses the same ancestor DndContext for an auxiliary controller", () => {
    renderAncestorItemSlides();

    expect(mockDndContext).not.toHaveBeenCalled();
    expect(mockDndMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        onDragStart: expect.any(Function),
        onDragEnd: expect.any(Function),
      }),
    );
  });

  it.each(["main", "auxiliary"])(
    "%s controller inserts media into an editable free item",
    async () => {
      const updateAction = await dropMediaAt(1, ["media-1"]);

      expect(updateAction.payload[1].boxes[0].mediaInfo.id).toBe("media-1");
    },
  );

  it("renders one provisional ghost at the active media insertion index", () => {
    mockDndState = {
      active: {
        data: { current: { kind: "media", mediaIds: ["media-2", "media-1"] } },
      },
      over: {
        data: { current: { kind: "slide-insert", index: 1 } },
      },
    };

    renderAncestorItemSlides();

    expect(screen.getByTestId("media-drag-ghost")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it.each([0, baseSlides.length])(
    "renders the ghost at insertion index %s",
    (index) => {
      mockDndState = {
        active: {
          data: { current: { kind: "media", mediaIds: ["media-1"] } },
        },
        over: {
          data: { current: { kind: "slide-insert", index } },
        },
      };

      renderAncestorItemSlides();

      expect(screen.getByTestId("media-drag-ghost")).toHaveAttribute(
        "data-insertion-index",
        String(index),
      );
    },
  );

  it("keeps the existing section reorder behavior", () => {
    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    act(() =>
      mockDndMonitorListener?.onDragStart?.({
        active: {
          id: "slide-2",
          data: { current: { kind: "slide", slideId: "slide-2" } },
        },
      }),
    );
    act(() => {
      mockDndMonitorListener?.onDragEnd?.({
        active: {
          id: "slide-2",
          data: { current: { kind: "slide", slideId: "slide-2" } },
        },
        over: {
          id: "slide-1",
          data: { current: { kind: "slide", slideId: "slide-1" } },
        },
      });
    });

    expect(mockDispatch).toHaveBeenCalledWith(expect.any(Function));
  });

  it("previews a free slide reorder before drop and commits that exact order", () => {
    mockState.undoable.present.item.slides = Array.from(
      { length: 5 },
      (_, index) => ({
        ...baseSlides[0],
        id: `slide-${index + 1}`,
        name: `Section ${index + 1}`,
      }),
    );
    renderAncestorItemSlides();
    const dragEvent = {
      active: {
        id: "slide-2",
        data: { current: { kind: "slide", slideId: "slide-2" } },
      },
      over: {
        id: "slide-5",
        data: { current: { kind: "slide", slideId: "slide-5" } },
      },
    };

    act(() => {
      mockDndMonitorListener?.onDragStart?.(dragEvent);
      mockDndMonitorListener?.onDragOver?.(dragEvent);
    });

    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(expect.arrayContaining(["Section 1", "Section 2", "Section 5"]));
    const slideButtons = screen
      .getAllByRole("button")
      .filter((button) => button.textContent?.startsWith("Section"));
    expect(slideButtons.map((button) => button.textContent)).toEqual([
      "Section 1",
      "Section 3",
      "Section 4",
      "Section 5",
      "Section 2",
    ]);

    mockDispatch.mockClear();
    act(() => mockDndMonitorListener?.onDragEnd?.(dragEvent));
    expect(mockDispatch).toHaveBeenCalledWith(expect.any(Function));
    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.textContent?.startsWith("Section"))
        .map((button) => button.textContent),
    ).toEqual([
      "Section 1",
      "Section 3",
      "Section 4",
      "Section 5",
      "Section 2",
    ]);
  });

  it("discards a free slide preview on drag cancel", () => {
    mockState.undoable.present.item.slides = Array.from(
      { length: 5 },
      (_, index) => ({
        ...baseSlides[0],
        id: `slide-${index + 1}`,
        name: `Section ${index + 1}`,
      }),
    );
    renderAncestorItemSlides();
    const dragEvent = {
      active: {
        id: "slide-2",
        data: { current: { kind: "slide", slideId: "slide-2" } },
      },
      over: {
        id: "slide-5",
        data: { current: { kind: "slide", slideId: "slide-5" } },
      },
    };
    act(() => {
      mockDndMonitorListener?.onDragStart?.(dragEvent);
      mockDndMonitorListener?.onDragOver?.(dragEvent);
    });
    mockDispatch.mockClear();
    act(() => mockDndMonitorListener?.onDragCancel?.());

    expect(mockDispatch).not.toHaveBeenCalledWith(expect.any(Function));
    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.textContent?.startsWith("Section"))
        .map((button) => button.textContent),
    ).toEqual([
      "Section 1",
      "Section 2",
      "Section 3",
      "Section 4",
      "Section 5",
    ]);
  });

  it.each([
    ["before the first slide", 0, ["media-1", "slide-1", "slide-2"]],
    ["between slides", 1, ["slide-1", "media-1", "slide-2"]],
    ["after the last slide", 2, ["slide-1", "slide-2", "media-1"]],
  ])("inserts one media slide %s", async (_label, index, expectedIds) => {
    const updateAction = await dropMediaAt(index as number, ["media-1"]);

    expect(
      updateAction.payload.map(
        (slide: any) => slide.boxes[0].mediaInfo?.id ?? slide.id,
      ),
    ).toEqual(expectedIds);
  });

  it("appends media dropped in the empty area after the last slide", async () => {
    const updateAction = await dropMediaAt(
      baseSlides.length,
      ["media-1"],
      "slide-container",
    );

    expect(updateAction.payload.at(-1).boxes[0].mediaInfo.id).toBe("media-1");
  });

  it("does not insert media dropped outside ItemSlides", async () => {
    const updateAction = await dropMediaAt(0, ["media-1"], null);

    expect(updateAction).toBeUndefined();
  });

  it("shows the ghost at the end of the grid for a valid empty-area drop", () => {
    mockDndState = {
      active: {
        data: { current: { kind: "media", mediaIds: ["media-1"] } },
      },
      over: {
        data: { current: { kind: "slide-container" } },
      },
    };

    renderAncestorItemSlides();

    expect(screen.getByTestId("media-drag-ghost")).toHaveAttribute(
      "data-insertion-index",
      String(baseSlides.length),
    );
  });

  it("inserts selected media in the existing Add N slides order", async () => {
    const updateAction = await dropMediaAt(1, ["media-2", "media-1"]);

    expect(
      updateAction.payload
        .map((slide: any) => slide.boxes[0].mediaInfo?.id)
        .filter(Boolean),
    ).toEqual(["media-2", "media-1"]);
  });

  it("does not insert media into a song item", async () => {
    mockState.undoable.present.item.type = "song";
    const updateAction = await dropMediaAt(1, ["media-1"]);

    expect(updateAction).toBeUndefined();
  });

  it("does not insert media into a read-only free item", async () => {
    mockDispatch.mockClear();
    renderAncestorItemSlides("view");
    act(() => {
      mockDndMonitorListener?.onDragEnd?.({
        active: {
          id: "media-1",
          data: { current: { kind: "media", mediaIds: ["media-1"] } },
        },
        over: {
          id: "slide-insert-1",
          data: { current: { kind: "slide-insert", index: 1 } },
        },
      });
    });

    expect(mockDispatch).not.toHaveBeenCalledWith(expect.any(Function));
  });

  it("does not run media insertion for a slide drag", async () => {
    mockDispatch.mockClear();
    renderAncestorItemSlides();
    act(() => {
      mockDndMonitorListener?.onDragEnd?.({
        active: {
          id: "slide-2",
          data: { current: { kind: "slide", slideId: "slide-2" } },
        },
        over: {
          id: "slide-insert-1",
          data: { current: { kind: "slide-insert", index: 1 } },
        },
      });
    });

    expect(mockDispatch).not.toHaveBeenCalledWith(expect.any(Function));
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
    expect(
      screen.queryByRole("button", { name: "Add" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear background" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
  });

  it("hides clear background in Present mode", () => {
    window.localStorage.setItem("worshipsync_presentation_controller_mode", "present");

    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <PresentationControllerModeProvider>
            <ItemSlides />
          </PresentationControllerModeProvider>
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(screen.queryByRole("button", { name: "Clear background" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
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
    expect(
      screen.queryByRole("button", { name: "Done" }),
    ).not.toBeInTheDocument();
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
          ["Done", "Add", "Copy", "Clear background", "Delete"].includes(label),
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

    expect(
      screen.queryByRole("button", { name: "Add" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
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
