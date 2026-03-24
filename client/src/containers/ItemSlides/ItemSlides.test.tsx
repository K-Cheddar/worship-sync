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
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
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

jest.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDroppable: () => ({ setNodeRef: jest.fn() }),
}));

jest.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  rectSortingStrategy: {},
}));

jest.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/controller/item/free-1/list-1" }),
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

describe("ItemSlides", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
            shouldSendTo: {
              monitor: true,
              projector: false,
              stream: false,
            },
            isEditMode: false,
          },
          preferences: {
            slidesPerRow: 3,
            slidesPerRowMobile: 2,
            shouldShowStreamFormat: false,
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
      },
      timers: {
        timers: [],
      },
    };
  });

  it("sends monitor-band next boxes for free items when next-slide view is enabled", () => {
    render(
      <GlobalInfoContext.Provider value={{ access: "full" } as any}>
        <ControllerInfoContext.Provider value={{ isMobile: false } as any}>
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
});
