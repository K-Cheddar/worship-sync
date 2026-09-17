import { fireEvent, render, screen, within } from "@testing-library/react";
import ItemSlide from "./ItemSlide";

const mockUseDroppable = jest.fn((_options?: unknown) => ({
  isOver: false,
  setNodeRef: jest.fn(),
}));

jest.mock("../../components/DisplayWindow/DisplayWindow", () => ({
  __esModule: true,
  default: () => <div data-testid="display-window-thumbnail" />,
}));

jest.mock("./StaticSlideThumbnail", () => ({
  __esModule: true,
  default: ({ slide }: { slide: { name: string } }) => (
    <div data-testid="static-slide-thumbnail">{slide.name}</div>
  ),
}));

jest.mock("../../components/FloatingWindow/FloatingWindow", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="floating-window">{children}</div>
  ),
}));

jest.mock("../../hooks", () => ({
  useSelector: () => [],
}));

jest.mock("@dnd-kit/core", () => ({
  useDndContext: () => ({ active: null }),
  useDroppable: (options: unknown) => {
    mockUseDroppable(options);
    return { isOver: false, setNodeRef: jest.fn() };
  },
}));

jest.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

const slide = {
  id: "slide-1",
  name: "Section 1",
  type: "Section",
  boxes: [],
} as never;

describe("ItemSlide media insertion zones", () => {
  beforeEach(() => {
    mockUseDroppable.mockClear();
  });

  it("keeps auxiliary insertion targets positioned inside the existing slide grid item", () => {
    render(
      <ul>
        <ItemSlide
          slide={slide}
          index={0}
          selectSlide={jest.fn()}
          isSelected={false}
          size={3}
          itemType="free"
          isMobile={false}
          draggedSection={null}
          isLive={false}
          isStreamFormat={false}
          getBibleInfo={() => ({ title: "", text: "" })}
          borderWidth="1px"
          hSize="text-sm"
          onSlideGridClick={jest.fn()}
          mediaInsertEnabled
        />
      </ul>,
    );

    const slideGridItem = screen.getByRole("listitem");
    expect(within(slideGridItem).getByTestId("static-slide-thumbnail")).toHaveTextContent(
      "Section 1",
    );
    expect(
      within(slideGridItem).queryByTestId("display-window-thumbnail"),
    ).not.toBeInTheDocument();
    const insertionTargets = within(slideGridItem).getAllByTestId(
      "media-slide-insert-target",
    );

    expect(insertionTargets).toHaveLength(2);
    expect(insertionTargets[0]).toHaveClass("top-0");
    expect(insertionTargets[1]).toHaveClass("bottom-0");
    expect(insertionTargets[0]).toHaveAttribute(
      "data-testid",
      "media-slide-insert-target",
    );
    insertionTargets.forEach((target) => {
      expect(target).toHaveClass("absolute");
      expect(target).toHaveClass("pointer-events-none");
    });

    const mediaTargets = mockUseDroppable.mock.calls.filter(
      ([options]) =>
        (options as { data?: { kind?: string } }).data?.kind ===
        "slide-insert",
    );
    expect(mediaTargets).toHaveLength(2);
    expect(mediaTargets.map(([options]) => (options as { id: string }).id)).toEqual([
      "slide-insert-0-top",
      "slide-insert-1-bottom",
    ]);
    expect(
      mediaTargets.map(
        ([options]) => (options as { data: { index: number } }).data.index,
      ),
    ).toEqual([0, 1]);
  });

  it("keeps rename-window pointer and click events out of the sortable slide", () => {
    const onSlideGridClick = jest.fn();
    render(
      <ul>
        <ItemSlide
          slide={slide}
          index={0}
          selectSlide={jest.fn()}
          isSelected
          size={3}
          itemType="free"
          isMobile={false}
          draggedSection={null}
          isLive={false}
          isStreamFormat={false}
          getBibleInfo={() => ({ title: "", text: "" })}
          borderWidth="1px"
          hSize="text-sm"
          onSlideGridClick={onSlideGridClick}
          canEdit
          onRenameSection={jest.fn()}
        />
      </ul>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename section" }));
    const renameWindow = screen.getByTestId("section-rename-window");
    const input = within(renameWindow).getByRole("textbox", {
      name: "Section name:",
    });

    fireEvent.pointerDown(input);
    fireEvent.mouseDown(input);
    fireEvent.click(input);

    expect(renameWindow).toHaveAttribute("data-no-dnd");
    expect(onSlideGridClick).not.toHaveBeenCalled();
  });

  it("calls the section rename handler when Save is pressed", () => {
    const onRenameSection = jest.fn();
    render(
      <ul>
        <ItemSlide
          slide={slide}
          index={0}
          selectSlide={jest.fn()}
          isSelected
          size={3}
          itemType="free"
          isMobile={false}
          draggedSection={null}
          isLive={false}
          isStreamFormat={false}
          getBibleInfo={() => ({ title: "", text: "" })}
          borderWidth="1px"
          hSize="text-sm"
          onSlideGridClick={jest.fn()}
          canEdit
          onRenameSection={onRenameSection}
        />
      </ul>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename section" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Section name:" }), {
      target: { value: "Welcome" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onRenameSection).toHaveBeenCalledWith(1, "Welcome");
  });
});
