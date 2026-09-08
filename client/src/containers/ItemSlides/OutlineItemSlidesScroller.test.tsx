import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import OutlineItemSlidesScroller from "./OutlineItemSlidesScroller";
import { setActiveItem } from "../../store/itemSlice";
import { setActiveItemInList } from "../../store/itemListSlice";
import type { DBItem, ItemSlideType, ServiceItem } from "../../types";

const mockDispatch = jest.fn();
const mockNavigate = jest.fn();
const mockSelectSlide = jest.fn();
const mockOnSlideGridClick = jest.fn();
let mockState: any;
let mockDocsById: Map<string, DBItem>;

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

jest.mock("../../hooks/useOutlineItemDocs", () => ({
  useOutlineItemDocs: () => mockDocsById,
}));

jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
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
    measure: jest.fn(),
    scrollToIndex: jest.fn(),
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
    onSlideGridClick,
  }: {
    index: number;
    slide: { name: string };
    onSlideGridClick: (e: React.MouseEvent, index: number) => void;
  }) => (
    <button type="button" onClick={(event) => onSlideGridClick(event, index)}>
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

const renderScroller = () => {
  const scrollRef = { current: null as HTMLElement | null };
  const view = render(
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
  return { ...view, scrollRef };
};

describe("OutlineItemSlidesScroller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    Object.defineProperty(window, "requestAnimationFrame", {
      writable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    });
    mockDocsById = new Map([
      ["song-1", songDoc("song-1", [slide("s1a", "Song 1 A"), slide("s1b", "Song 1 B")])],
      ["song-2", songDoc("song-2", [slide("s2a", "Song 2 A")])],
    ]);
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
                slides: [slide("s1a", "Song 1 A"), slide("s1b", "Song 1 B")],
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
    expect(screen.queryByText("Section")).not.toBeInTheDocument();
  });

  it("updates outline selection on scroll without sending a slide", () => {
    const { scrollRef } = renderScroller();
    const root = screen.getByTestId("scroll-root");
    expect(scrollRef.current).toBe(root);

    root.scrollTop = 80;
    fireEvent.scroll(root);

    expect(mockDispatch).toHaveBeenCalledWith(setActiveItemInList("l-2"));
    expect(mockSelectSlide).not.toHaveBeenCalled();
    expect(mockOnSlideGridClick).not.toHaveBeenCalled();
    expect(mockDispatch.mock.calls.some(([action]) =>
      String(action?.type ?? "").startsWith("presentation/"),
    )).toBe(false);

    act(() => {
      jest.advanceTimersByTime(120);
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      setActiveItem(
        expect.objectContaining({
          _id: "song-2",
          listId: "l-2",
        }),
      ),
    );
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining("/controller/item/"),
      { replace: true },
    );
    expect(mockSelectSlide).not.toHaveBeenCalled();
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
        }),
      ),
    );
    expect(mockOnSlideGridClick).not.toHaveBeenCalled();

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

    expect(mockSelectSlide).toHaveBeenCalledWith(0);
  });
});
