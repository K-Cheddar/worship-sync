import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import OutlineItemSlidesScroller from "./OutlineItemSlidesScroller";
import { setActiveItem } from "../../store/itemSlice";
import { setActiveItemInList } from "../../store/itemListSlice";
import { keepElementInView } from "../../utils/generalUtils";
import { requestOutlineSelectionScroll } from "../../utils/outlineSelectionScroll";
import type { DBItem, ItemSlideType, ServiceItem } from "../../types";

const mockDispatch = jest.fn();
const mockNavigate = jest.fn();
const mockSelectSlide = jest.fn();
const mockOnSlideGridClick = jest.fn();
const mockScrollToIndex = jest.fn();
const mockVirtualizerMeasure = jest.fn();
const mockUseOutlineItemDocs = jest.fn();
let mockState: any;
let mockDocsById: Map<string, DBItem>;
const mockResizeObserverCallbacks: ResizeObserverCallback[] = [];

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

jest.mock("../../hooks/useOutlineItemDocs", () => ({
  useOutlineItemDocs: (...args: unknown[]) => mockUseOutlineItemDocs(...args),
}));

jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock("../../utils/generalUtils", () => ({
  keepElementInView: jest.fn(() => true),
}));

jest.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 40,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 40,
      })),
    measureElement: jest.fn(),
    measure: mockVirtualizerMeasure,
    scrollToIndex: (...args: unknown[]) => mockScrollToIndex(...args),
    getOffsetForIndex: (index: number) => [index * 40, "start"] as const,
  }),
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
    slideDomId,
    onSlideGridClick,
  }: {
    index: number;
    slide: { name: string };
    slideDomId?: string;
    onSlideGridClick: (e: React.MouseEvent, index: number) => void;
  }) => (
    <button
      id={slideDomId}
      type="button"
      onClick={(event) => onSlideGridClick(event, index)}
    >
      {slide.name}
    </button>
  ),
}));

const slide = (id: string, name: string): ItemSlideType =>
  ({
    id,
    name,
    type: "Verse",
    boxes: [],
  }) as ItemSlideType;

const song = (id: string, listId: string, name: string): ServiceItem =>
  ({
    _id: id,
    listId,
    name,
    type: "song",
  }) as ServiceItem;

const songDoc = (id: string, slides: ItemSlideType[]): DBItem =>
  ({
    _id: id,
    _rev: `${id}-rev`,
    name: id,
    type: "song",
    selectedArrangement: 0,
    arrangements: [
      {
        id: "arr-1",
        name: "Default",
        formattedLyrics: [],
        songOrder: [],
        slides,
      },
    ],
    slides: [],
    shouldSendTo: { projector: true, monitor: true, stream: true },
  }) as DBItem;

const sizeConfig = {
  cols: "grid-cols-2",
  hSize: "text-sm",
  borderWidth: "2px",
};

const outlineScrollerUi = (
  scrollRef: { current: HTMLElement | null },
  selectedSlide = 0,
) => (
  <div
    ref={(node) => {
      scrollRef.current = node;
    }}
    data-testid="scroll-root"
    style={{ height: 80, overflow: "auto" }}
  >
    <OutlineItemSlidesScroller
      scrollRef={scrollRef}
      cols={2}
      size={2}
      sizeConfig={sizeConfig}
      isMobile={false}
      isStreamFormat={false}
      canEdit
      selectedSlide={selectedSlide}
      liveSlideIds={new Set()}
      backgroundTargetSlideIds={[]}
      draggedSection={null}
      timers={[]}
      selectSlide={mockSelectSlide}
      onSlideGridClick={mockOnSlideGridClick}
    />
  </div>
);

const setBoundingRect = (element: HTMLElement, top: number, bottom: number) => {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({ top, bottom, height: bottom - top } as DOMRect),
  });
};

const renderScroller = (selectedSlide = 0, cols = 2) => {
  const scrollRef = { current: null as HTMLElement | null };
  const setScrollNode = (node: HTMLElement | null) => {
    scrollRef.current = node;
    if (node) {
      Object.defineProperty(node, "clientHeight", {
        configurable: true,
        value: 80,
      });
      Object.defineProperty(node, "clientWidth", {
        configurable: true,
        value: 1000,
      });
    }
  };
  const ui = (
    <div
      ref={setScrollNode}
      data-testid="scroll-root"
      style={{ height: 80, overflow: "auto" }}
    >
      <OutlineItemSlidesScroller
        scrollRef={scrollRef}
        cols={cols}
        size={cols}
        sizeConfig={sizeConfig}
        isMobile={false}
        isStreamFormat={false}
        canEdit
        selectedSlide={selectedSlide}
        liveSlideIds={new Set()}
        backgroundTargetSlideIds={[]}
        draggedSection={null}
        timers={[]}
        selectSlide={mockSelectSlide}
        onSlideGridClick={mockOnSlideGridClick}
      />
    </div>
  );
  const view = render(ui);
  return {
    ...view,
    scrollRef,
    rerenderWithSlide: (nextSlide: number) =>
      view.rerender(
        <div
          ref={setScrollNode}
          data-testid="scroll-root"
          style={{ height: 80, overflow: "auto" }}
        >
          <OutlineItemSlidesScroller
            scrollRef={scrollRef}
            cols={cols}
            size={cols}
            sizeConfig={sizeConfig}
            isMobile={false}
            isStreamFormat={false}
            canEdit
            selectedSlide={nextSlide}
            liveSlideIds={new Set()}
            backgroundTargetSlideIds={[]}
            draggedSection={null}
            timers={[]}
            selectSlide={mockSelectSlide}
            onSlideGridClick={mockOnSlideGridClick}
          />
        </div>,
      ),
    rerenderWithCols: (nextCols: number) =>
      view.rerender(
        <div
          ref={setScrollNode}
          data-testid="scroll-root"
          style={{ height: 80, overflow: "auto" }}
        >
          <OutlineItemSlidesScroller
            scrollRef={scrollRef}
            cols={nextCols}
            size={nextCols}
            sizeConfig={sizeConfig}
            isMobile={false}
            isStreamFormat={false}
            canEdit
            selectedSlide={selectedSlide}
            liveSlideIds={new Set()}
            backgroundTargetSlideIds={[]}
            draggedSection={null}
            timers={[]}
            selectSlide={mockSelectSlide}
            onSlideGridClick={mockOnSlideGridClick}
          />
        </div>,
      ),
    rerenderWithContentSlides: (nextSlides: ItemSlideType[]) => {
      mockState.undoable.present.item = {
        ...mockState.undoable.present.item,
        arrangements: [
          {
            ...mockState.undoable.present.item.arrangements[0],
            slides: nextSlides,
          },
        ],
      };
      view.rerender(
        <div
          ref={setScrollNode}
          data-testid="scroll-root"
          style={{ height: 80, overflow: "auto" }}
        >
          <OutlineItemSlidesScroller
            scrollRef={scrollRef}
            cols={cols}
            size={cols}
            sizeConfig={sizeConfig}
            isMobile={false}
            isStreamFormat={false}
            canEdit
            selectedSlide={selectedSlide}
            liveSlideIds={new Set()}
            backgroundTargetSlideIds={[]}
            draggedSection={null}
            timers={[]}
            selectSlide={mockSelectSlide}
            onSlideGridClick={mockOnSlideGridClick}
          />
        </div>,
      );
    },
  };
};

describe("OutlineItemSlidesScroller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockResizeObserverCallbacks.length = 0;
    const resizeObserver = jest
      .fn()
      .mockImplementation((callback: ResizeObserverCallback) => {
        mockResizeObserverCallbacks.push(callback);
        return {
          observe: jest.fn(),
          unobserve: jest.fn(),
          disconnect: jest.fn(),
        };
      });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: resizeObserver,
    });
    Object.defineProperty(global, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: resizeObserver,
    });
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: resizeObserver,
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      writable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
    mockDocsById = new Map([
      [
        "song-1",
        songDoc("song-1", [
          slide("s1a", "Song 1 A"),
          slide("s1b", "Song 1 B"),
          slide("s1c", "Song 1 C"),
          slide("s1d", "Song 1 D"),
        ]),
      ],
      ["song-2", songDoc("song-2", [slide("s2a", "Song 2 A")])],
    ]);
    mockUseOutlineItemDocs.mockImplementation(() => mockDocsById);
    mockState = {
      undoable: {
        present: {
          item: {
            _id: "song-1",
            listId: "l-1",
            name: "Song One",
            type: "song",
            selectedArrangement: 0,
            arrangements: [
              {
                id: "arr-1",
                name: "Default",
                formattedLyrics: [],
                songOrder: [],
                slides: [
                  slide("s1a", "Song 1 A"),
                  slide("s1b", "Song 1 B"),
                  slide("s1c", "Song 1 C"),
                  slide("s1d", "Song 1 D"),
                ],
              },
            ],
            slides: [],
          },
          itemList: {
            selectedItemListId: "l-1",
            list: [
              song("song-1", "l-1", "Song One"),
              { _id: "h1", listId: "h-1", name: "Section", type: "heading" },
              song("song-2", "l-2", "Song Two"),
            ],
          },
        },
      },
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders the next outline item after the current slides", () => {
    renderScroller();

    expect(screen.getByTestId("outline-slide-section-l-1")).toHaveTextContent(
      "Song One",
    );
    expect(screen.getByTestId("outline-slide-section-l-2")).toHaveTextContent(
      "Song Two",
    );
    expect(screen.getByRole("button", { name: "Song 2 A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Song 2 A" })).toHaveStyle({
      borderWidth: "2px",
    });
    expect(screen.queryByText("Section")).not.toBeInTheDocument();
  });

  it("does not change item or slide selection on manual scroll", () => {
    const { scrollRef } = renderScroller();
    const root = screen.getByTestId("scroll-root");
    expect(scrollRef.current).toBe(root);

    // Unlock initial scroll + clear ignorePin from the programmatic scroll.
    act(() => {
      jest.advanceTimersByTime(320);
    });

    mockDispatch.mockClear();
    mockNavigate.mockClear();
    mockSelectSlide.mockClear();
    mockOnSlideGridClick.mockClear();

    root.scrollTop = 120;
    fireEvent.scroll(root);

    act(() => {
      jest.advanceTimersByTime(120);
    });

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockSelectSlide).not.toHaveBeenCalled();
    expect(mockOnSlideGridClick).not.toHaveBeenCalled();
  });

  it("invalidates virtual row geometry when the content width changes", () => {
    const { scrollRef } = renderScroller();
    const root = screen.getByTestId("scroll-root");
    expect(scrollRef.current).toBe(root);
    mockVirtualizerMeasure.mockClear();

    Object.defineProperty(root, "clientWidth", {
      configurable: true,
      value: 700,
    });
    act(() => {
      mockResizeObserverCallbacks[0]?.([], {} as ResizeObserver);
    });

    expect(mockVirtualizerMeasure).toHaveBeenCalled();
  });

  it("scrolls to the selected outline item on mount", () => {
    mockState.undoable.present.itemList.selectedItemListId = "l-2";
    mockState.undoable.present.item = {
      ...mockState.undoable.present.item,
      _id: "song-2",
      listId: "l-2",
      arrangements: [
        {
          id: "arr-1",
          name: "Default",
          formattedLyrics: [],
          songOrder: [],
          slides: [slide("s2a", "Song 2 A")],
        },
      ],
    };

    const { scrollRef } = renderScroller();
    const root = screen.getByTestId("scroll-root");

    // Selected slide 0 of l-2 is the tile row at index 4 with 4 slides on l-1
    // (label + 2 tile rows) ahead of it.
    expect(scrollRef.current).toBe(root);
    expect(root.scrollTop).toBe(160);
  });

  it("keeps the selected slide in view when selection changes", () => {
    const { rerenderWithSlide } = renderScroller(0);

    act(() => {
      jest.advanceTimersByTime(320);
    });
    mockScrollToIndex.mockClear();
    (keepElementInView as jest.Mock).mockClear();

    rerenderWithSlide(2);

    // Mounted tiles use keepElementInView only (no competing smooth scrollToIndex).
    expect(mockScrollToIndex).not.toHaveBeenCalled();
    expect(keepElementInView).toHaveBeenCalledWith(
      expect.objectContaining({
        child: expect.objectContaining({ id: "item-slide-l-1-2" }),
        shouldScrollToCenter: true,
      }),
    );
  });

  it("keeps the selected slide in view when zooming while it is on screen", () => {
    const { rerenderWithCols } = renderScroller(0);

    act(() => {
      jest.advanceTimersByTime(320);
    });
    mockScrollToIndex.mockClear();
    (keepElementInView as jest.Mock).mockClear();

    rerenderWithCols(1);

    expect(mockScrollToIndex).toHaveBeenCalledWith(1, {
      align: "center",
      behavior: "auto",
    });
    expect(keepElementInView).not.toHaveBeenCalled();
  });

  it("restores an off-screen selected slide when zooming", () => {
    const { rerenderWithCols } = renderScroller(0);
    const root = screen.getByTestId("scroll-root");

    act(() => {
      jest.advanceTimersByTime(320);
    });
    mockScrollToIndex.mockClear();
    mockDispatch.mockClear();

    root.scrollTop = 160;
    rerenderWithCols(1);

    // The selected slide is in the first tile row after the repack, so zoom
    // restores that row instead of preserving the deep viewport offset.
    expect(root.scrollTop).toBe(0);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockScrollToIndex).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ align: "center" }),
    );
  });

  it("keeps the selected slide in view when content rows rebuild", () => {
    const { rerenderWithContentSlides } = renderScroller(0);

    act(() => {
      jest.advanceTimersByTime(320);
    });
    mockScrollToIndex.mockClear();
    mockDispatch.mockClear();

    rerenderWithContentSlides([
      slide("s1a", "Song 1 A updated"),
      slide("s1b", "Song 1 B"),
      slide("s1c", "Song 1 C"),
      slide("s1d", "Song 1 D"),
      slide("s1e", "Song 1 E"),
    ]);

    expect(mockScrollToIndex).toHaveBeenCalledWith(1, {
      align: "center",
      behavior: "auto",
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("lets the newest rapid zoom change own selected-slide restoration", () => {
    const { rerenderWithCols } = renderScroller(2, 4);

    act(() => {
      jest.advanceTimersByTime(320);
    });
    mockScrollToIndex.mockClear();

    rerenderWithCols(2);
    rerenderWithCols(6);
    rerenderWithCols(1);
    rerenderWithCols(5);

    const selectedRestoreCalls = mockScrollToIndex.mock.calls.filter(
      ([, options]) =>
        (options as { align?: string } | undefined)?.align === "center",
    );
    expect(selectedRestoreCalls.at(-1)).toEqual([
      1,
      { align: "center", behavior: "auto" },
    ]);
  });

  it("scrolls back to the selected slide when the current outline item is re-clicked", () => {
    const { rerenderWithSlide } = renderScroller(0);

    act(() => {
      jest.advanceTimersByTime(320);
    });
    rerenderWithSlide(2);
    mockScrollToIndex.mockClear();
    (keepElementInView as jest.Mock).mockClear();

    act(() => {
      requestOutlineSelectionScroll();
    });

    expect(mockScrollToIndex).not.toHaveBeenCalled();
    expect(keepElementInView).toHaveBeenCalledWith(
      expect.objectContaining({
        child: expect.objectContaining({ id: "item-slide-l-1-2" }),
        shouldScrollToCenter: true,
      }),
    );
  });

  it("keeps a visible cross-item click stationary through active-row rebuild", () => {
    const scrollRef = { current: null as HTMLElement | null };
    const { rerender } = render(outlineScrollerUi(scrollRef));
    const root = screen.getByTestId("scroll-root");
    const clickedSlide = screen.getByRole("button", { name: "Song 2 A" });
    setBoundingRect(root, 0, 80);
    setBoundingRect(clickedSlide, 20, 60);
    act(() => {
      jest.advanceTimersByTime(320);
    });
    root.scrollTop = 24;
    mockScrollToIndex.mockClear();
    (keepElementInView as jest.Mock).mockClear();

    fireEvent.click(clickedSlide);

    mockState.undoable.present.itemList.selectedItemListId = "l-2";
    mockState.undoable.present.item = {
      ...mockState.undoable.present.item,
      _id: "song-2",
      listId: "l-2",
    };
    rerender(outlineScrollerUi(scrollRef));

    expect(mockSelectSlide).toHaveBeenCalledWith(0, {
      presentationOnly: true,
      presentation: expect.objectContaining({ listId: "l-2" }),
    });
    expect(mockDispatch).toHaveBeenCalledWith(setActiveItemInList("l-2"));
    expect(root.scrollTop).toBe(24);
    expect(mockScrollToIndex).not.toHaveBeenCalled();
    expect(keepElementInView).toHaveBeenCalledTimes(1);
  });

  it("uses the selection path once for an offscreen cross-item click", () => {
    const scrollRef = { current: null as HTMLElement | null };
    const { rerender } = render(outlineScrollerUi(scrollRef));
    const root = screen.getByTestId("scroll-root");
    const clickedSlide = screen.getByRole("button", { name: "Song 2 A" });
    setBoundingRect(root, 0, 80);
    setBoundingRect(clickedSlide, 100, 140);
    act(() => {
      jest.advanceTimersByTime(320);
    });
    mockScrollToIndex.mockClear();
    (keepElementInView as jest.Mock).mockClear();

    fireEvent.click(clickedSlide);

    mockState.undoable.present.itemList.selectedItemListId = "l-2";
    mockState.undoable.present.item = {
      ...mockState.undoable.present.item,
      _id: "song-2",
      listId: "l-2",
    };
    rerender(outlineScrollerUi(scrollRef));
    act(() => {
      jest.advanceTimersByTime(80);
    });

    expect(mockDispatch).toHaveBeenCalledWith(setActiveItemInList("l-2"));
    expect(mockSelectSlide).toHaveBeenCalledWith(0, {
      presentationOnly: true,
      presentation: expect.objectContaining({ listId: "l-2" }),
    });
    expect(mockScrollToIndex).not.toHaveBeenCalled();
    expect(keepElementInView).toHaveBeenCalledTimes(1);
    expect(keepElementInView).toHaveBeenCalledWith(
      expect.objectContaining({
        child: expect.objectContaining({ id: "item-slide-l-2-0" }),
        shouldScrollToCenter: true,
      }),
    );
  });

  it("does not scroll for a visible same-item slide click", () => {
    renderScroller();
    const root = screen.getByTestId("scroll-root");
    const clickedSlide = screen.getByRole("button", { name: "Song 1 B" });
    setBoundingRect(root, 0, 80);
    setBoundingRect(clickedSlide, 20, 60);
    mockScrollToIndex.mockClear();
    (keepElementInView as jest.Mock).mockClear();

    fireEvent.click(clickedSlide);

    expect(mockOnSlideGridClick).toHaveBeenCalledWith(expect.anything(), 1);
    expect(mockScrollToIndex).not.toHaveBeenCalled();
    expect(keepElementInView).not.toHaveBeenCalled();
  });

  it("keeps externally driven item navigation scrolling to its selected slide", () => {
    const scrollRef = { current: null as HTMLElement | null };
    const { rerender } = render(outlineScrollerUi(scrollRef));
    act(() => {
      jest.advanceTimersByTime(320);
    });
    (keepElementInView as jest.Mock).mockClear();

    mockState.undoable.present.itemList.selectedItemListId = "l-2";
    mockState.undoable.present.item = {
      ...mockState.undoable.present.item,
      _id: "song-2",
      listId: "l-2",
    };
    rerender(outlineScrollerUi(scrollRef));

    expect(keepElementInView).toHaveBeenCalledWith(
      expect.objectContaining({
        child: expect.objectContaining({ id: "item-slide-l-2-0" }),
        shouldScrollToCenter: true,
      }),
    );
  });

  it("sends on an explicit click after activating a neighbor item", () => {
    const scrollRef = { current: null as HTMLElement | null };
    const ui = (
      <div
        ref={(node) => {
          scrollRef.current = node;
        }}
        data-testid="scroll-root"
        style={{ height: 80, overflow: "auto" }}
      >
        <OutlineItemSlidesScroller
          scrollRef={scrollRef}
          cols={2}
          size={2}
          sizeConfig={sizeConfig}
          isMobile={false}
          isStreamFormat={false}
          canEdit
          selectedSlide={0}
          liveSlideIds={new Set()}
          backgroundTargetSlideIds={[]}
          draggedSection={null}
          timers={[]}
          selectSlide={mockSelectSlide}
          onSlideGridClick={mockOnSlideGridClick}
        />
      </div>
    );
    const { rerender } = render(ui);

    fireEvent.click(screen.getByRole("button", { name: "Song 2 A" }));

    expect(mockDispatch).toHaveBeenCalledWith(setActiveItemInList("l-2"));
    expect(mockDispatch).toHaveBeenCalledWith(
      setActiveItem(
        expect.objectContaining({
          _id: "song-2",
          listId: "l-2",
          selectedSlide: 0,
        }),
      ),
    );
    expect(mockOnSlideGridClick).not.toHaveBeenCalled();
    expect(mockSelectSlide).toHaveBeenCalledTimes(1);
    expect(mockSelectSlide).toHaveBeenCalledWith(0, {
      presentationOnly: true,
      presentation: expect.objectContaining({
        slides: [expect.objectContaining({ id: "s2a" })],
        itemId: "song-2",
        listId: "l-2",
      }),
    });

    mockState.undoable.present.item = {
      ...mockState.undoable.present.item,
      _id: "song-2",
      listId: "l-2",
    };
    rerender(
      <div
        ref={(node) => {
          scrollRef.current = node;
        }}
        data-testid="scroll-root"
        style={{ height: 80, overflow: "auto" }}
      >
        <OutlineItemSlidesScroller
          scrollRef={scrollRef}
          cols={2}
          size={2}
          sizeConfig={sizeConfig}
          isMobile={false}
          isStreamFormat={false}
          canEdit
          selectedSlide={0}
          liveSlideIds={new Set()}
          backgroundTargetSlideIds={[]}
          draggedSection={null}
          timers={[]}
          selectSlide={mockSelectSlide}
          onSlideGridClick={mockOnSlideGridClick}
        />
      </div>,
    );

    expect(mockSelectSlide).toHaveBeenCalledTimes(1);
  });

  it("keeps rapid cross-item clicks on their own presentation intents", () => {
    const scrollRef = { current: null as HTMLElement | null };
    const renderUi = () => (
      <div
        ref={(node) => {
          scrollRef.current = node;
        }}
        data-testid="scroll-root"
        style={{ height: 80, overflow: "auto" }}
      >
        <OutlineItemSlidesScroller
          scrollRef={scrollRef}
          cols={2}
          size={2}
          sizeConfig={sizeConfig}
          isMobile={false}
          isStreamFormat={false}
          canEdit
          selectedSlide={0}
          liveSlideIds={new Set()}
          backgroundTargetSlideIds={[]}
          draggedSection={null}
          timers={[]}
          selectSlide={mockSelectSlide}
          onSlideGridClick={mockOnSlideGridClick}
        />
      </div>
    );
    const { rerender } = render(renderUi());

    fireEvent.click(screen.getByRole("button", { name: "Song 2 A" }));

    mockState.undoable.present.item = {
      ...mockState.undoable.present.item,
      _id: "song-2",
      listId: "l-2",
    };
    rerender(renderUi());
    fireEvent.click(
      screen.getAllByRole("button", { name: "Song 1 B" })[0],
    );

    expect(mockOnSlideGridClick).not.toHaveBeenCalled();
    expect(mockSelectSlide).toHaveBeenCalledTimes(2);
    expect(mockSelectSlide.mock.calls.map(([index, options]) => ({
      index,
      itemId: options.presentation.itemId,
      slideId: options.presentation.slides[index].id,
    }))).toEqual([
      { index: 0, itemId: "song-2", slideId: "s2a" },
      { index: 1, itemId: "song-1", slideId: "s1b" },
    ]);
    expect(mockDispatch).toHaveBeenLastCalledWith(
      setActiveItem(
        expect.objectContaining({
          _id: "song-1",
          listId: "l-1",
          selectedSlide: 1,
        }),
      ),
    );
  });
});
