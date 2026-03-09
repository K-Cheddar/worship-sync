import { render, screen, fireEvent, act } from "@testing-library/react";
import SlideEditor from "../SlideEditor";

const mockDispatch = jest.fn();
let mockState: any;

const mockSetIsEditMode = jest.fn((value: boolean) => ({
  type: "item/setIsEditMode",
  payload: value,
}));
const mockUpdateSlides = jest.fn((payload: any) => ({
  type: "item/updateSlides",
  payload,
}));
const mockSetShouldShowItemEditor = jest.fn((value: boolean) => ({
  type: "preferences/setShouldShowItemEditor",
  payload: value,
}));

const mockFormatFree = jest.fn((item: any) => item);

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
  useCurrentItem: () => mockState.undoable.present.item,
}));

jest.mock("../../../store/itemSlice", () => ({
  setSelectedBox: jest.fn((value: number) => ({
    type: "item/setSelectedBox",
    payload: value,
  })),
  setSelectedSlide: jest.fn((value: number) => ({
    type: "item/setSelectedSlide",
    payload: value,
  })),
  setIsEditMode: (value: boolean) => mockSetIsEditMode(value),
  updateArrangements: jest.fn((payload: any) => ({
    type: "item/updateArrangements",
    payload,
  })),
  updateSlides: (payload: any) => mockUpdateSlides(payload),
  setName: jest.fn((payload: any) => ({ type: "item/setName", payload })),
  updateBoxes: jest.fn((payload: any) => ({ type: "item/updateBoxes", payload })),
}));

jest.mock("../../../store/preferencesSlice", () => ({
  setShouldShowItemEditor: (value: boolean) => mockSetShouldShowItemEditor(value),
}));

jest.mock("../../../utils/overflow", () => ({
  formatBible: jest.fn((item: any) => item),
  formatFree: (item: any) => mockFormatFree(item),
  formatSong: jest.fn((item: any) => item),
}));

jest.mock("../../../components/ErrorBoundary/ErrorBoundary", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("../../../components/DisplayWindow/DisplayWindow", () => ({
  __esModule: true,
  default: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="display-window" data-disabled={disabled ? "true" : "false"} />
  ),
}));

jest.mock("../../../components/SectionTextEditor/SectionTextEditor", () => ({
  __esModule: true,
  default: ({
    disabled,
    sectionName,
    value,
    onChange,
  }: {
    disabled?: boolean;
    sectionName: string;
    value: string;
    onChange: (v: string, cursor?: number) => void;
  }) => (
    <div data-testid="section-text-editor" data-disabled={disabled ? "true" : "false"}>
      <span>{sectionName}</span>
      <span>{value}</span>
      <button
        type="button"
        onClick={() => onChange("Updated section text", 3)}
        disabled={disabled}
      >
        trigger-section-change
      </button>
    </div>
  ),
}));

jest.mock("../../../components/SlideBoxes/SlideBoxes", () => ({
  __esModule: true,
  default: () => <div data-testid="slide-boxes" />,
}));

jest.mock("../../../components/LoadingOverlay/LoadingOverlay", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("../BibleItemActions", () => ({
  __esModule: true,
  default: () => <div data-testid="bible-actions" />,
}));

jest.mock("../../../components/TimerControls/TimerControls", () => ({
  __esModule: true,
  default: () => <div data-testid="timer-controls" />,
}));

const makeBaseState = (overrides: Partial<any> = {}) => {
  const base = {
    undoable: {
      present: {
        item: {
          name: "Sample Item",
          type: "free",
          arrangements: [],
          selectedArrangement: 0,
          selectedSlide: 0,
          selectedBox: 1,
          slides: [
            {
              id: "s1",
              type: "Media",
              name: "Section 1A",
              boxes: [
                { width: 100, height: 100, words: "BG", x: 0, y: 0 },
                { width: 100, height: 100, words: "Hello", x: 0, y: 0 },
              ],
            },
          ],
          formattedSections: [{ sectionNum: 1, words: "Hello", slideSpan: 1 }],
          isLoading: false,
          isSectionLoading: false,
        },
        preferences: {
          shouldShowItemEditor: true,
          toolbarSection: "settings",
        },
      },
    },
  };
  return {
    ...base,
    ...overrides,
    undoable: {
      ...base.undoable,
      ...(overrides as any).undoable,
      present: {
        ...base.undoable.present,
        ...((overrides as any).undoable?.present || {}),
        item: {
          ...base.undoable.present.item,
          ...((overrides as any).undoable?.present?.item || {}),
        },
        preferences: {
          ...base.undoable.present.preferences,
          ...((overrides as any).undoable?.present?.preferences || {}),
        },
      },
    },
  };
};

describe("SlideEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = makeBaseState();
  });

  it("renders empty state when no slide is selected", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            slides: [],
          },
        },
      },
    });

    render(<SlideEditor access="full" />);
    expect(screen.getByText("No slide selected")).toBeInTheDocument();
  });

  it("renders box tools panel when toolbar section is box-tools", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          preferences: { toolbarSection: "box-tools" },
        },
      },
    });

    render(<SlideEditor access="full" />);
    expect(screen.getByTestId("slide-boxes")).toBeInTheDocument();
    expect(screen.queryByTestId("section-text-editor")).not.toBeInTheDocument();
  });

  it("dispatches edit-mode action when song Edit Lyrics is clicked", () => {
    mockState = makeBaseState({
      undoable: {
        present: {
          item: {
            type: "song",
            arrangements: [{ name: "Default", slides: [], formattedLyrics: [] }],
          },
        },
      },
    });

    render(<SlideEditor access="full" />);
    fireEvent.click(screen.getByRole("button", { name: /edit lyrics/i }));

    expect(mockSetIsEditMode).toHaveBeenCalledWith(true);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "item/setIsEditMode",
      payload: true,
    });
  });

  it("updates free section text and dispatches debounced reformat update", () => {
    jest.useFakeTimers();
    mockFormatFree.mockImplementation((item) => ({
      ...item,
      slides: [{ ...item.slides[0], name: "Section 1A (formatted)" }],
      formattedSections: item.formattedSections,
    }));

    render(<SlideEditor access="full" />);
    fireEvent.click(screen.getByRole("button", { name: "trigger-section-change" }));

    expect(mockUpdateSlides).toHaveBeenCalledWith({
      slides: mockState.undoable.present.item.slides,
      formattedSections: [
        {
          sectionNum: 1,
          words: "Updated section text",
          slideSpan: 1,
        },
      ],
    });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(mockFormatFree).toHaveBeenCalled();
    expect(mockUpdateSlides).toHaveBeenLastCalledWith({
      slides: [
        {
          ...mockState.undoable.present.item.slides[0],
          name: "Section 1A (formatted)",
        },
      ],
      formattedSections: [
        {
          sectionNum: 1,
          words: "Updated section text",
          slideSpan: 1,
        },
      ],
    });

    jest.useRealTimers();
  });
});
