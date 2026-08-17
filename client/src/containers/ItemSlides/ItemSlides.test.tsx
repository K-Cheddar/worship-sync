import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ItemSlides from "./ItemSlides";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ToastContext } from "../../context/toastContext";
import { LocalVideoCaptureOwnedError } from "../../utils/localVideoCapturePool";

const mockDispatch = jest.fn();
const mockBuildLocalVideoInputPresentation = jest.fn();
const mockAcquireWarmLocalVideoCapture = jest.fn();
const mockReleaseWarmLocalVideoCapture = jest.fn();
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

jest.mock("../../utils/localVideoInput", () => ({
  ...jest.requireActual("../../utils/localVideoInput"),
  buildLocalVideoInputPresentation: (...args: unknown[]) =>
    mockBuildLocalVideoInputPresentation(...args),
  resolveLocalVideoInputBinding: jest.fn(() => ({
    sourceId: "source-1",
    deviceId: "capture-1",
    deviceLabel: "USB Capture",
  })),
}));
jest.mock("../../utils/localVideoCapturePool", () => ({
  acquireWarmLocalVideoCapture: (...args: unknown[]) =>
    mockAcquireWarmLocalVideoCapture(...args),
  releaseWarmLocalVideoCapture: (...args: unknown[]) =>
    mockReleaseWarmLocalVideoCapture(...args),
  LocalVideoCaptureOwnedError: class extends Error { },
}));

jest.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDroppable: () => ({ setNodeRef: jest.fn() }),
}));

jest.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  rectSortingStrategy: {},
}));

jest.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/controller/item/free-1/list-1" }),
}));

jest.mock("../../store/itemSlice", () => {
  const actual = jest.requireActual("../../store/itemSlice") as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    clearSlideBackgroundsOnSubset: (payload: { slideIds: string[] }) => ({
      type: "item/clearSlideBackgroundsOnSubset",
      payload,
    }),
    removeSlidesByIds: (payload: { slideIds: string[] }) => ({
      type: "item/removeSlidesByIds",
      payload,
    }),
  };
});

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
    mockBuildLocalVideoInputPresentation.mockReturnValue({
      sourceId: "source-1",
      deviceLabel: "USB Capture",
      ownerDeviceId: "local-device",
      ownerLabel: "Booth",
      fit: "contain",
      audioEnabled: true,
    });
    mockAcquireWarmLocalVideoCapture.mockResolvedValue({ stream: {} });
    mockReleaseWarmLocalVideoCapture.mockResolvedValue(undefined);
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

  it("sends a saved video-input slide through the normal item targets", async () => {
    const videoSlide = {
      id: "video-slide",
      type: "Media",
      name: "Main camera",
      boxes: [],
      mediaSource: {
        kind: "local-video-input",
        sourceId: "source-1",
        label: "Main camera",
        fit: "contain",
        audioEnabled: true,
      },
    };
    mockState.undoable.present.item.slides = [videoSlide];
    mockState.undoable.present.item.shouldSendTo = {
      projector: false,
      monitor: false,
      stream: true,
      outputIds: ["stream"],
    };
    mockState.displayOutputs = {
      list: [{ id: "stream", name: "Stream", type: "stream", enabled: true }],
    };
    mockState.presentation.outputs = {
      stream: {
        id: "stream",
        type: "stream",
        isTransmitting: true,
        info: { displayType: "stream", slide: null },
        prevInfo: { displayType: "stream", slide: null },
      },
      projector: {
        id: "projector",
        type: "projector",
        isTransmitting: true,
        info: {
          displayType: "projector",
          slide: { id: "old-video-slide", boxes: [] },
          localVideoInput: { sourceId: "source-1" },
        },
        prevInfo: { displayType: "projector", slide: null },
      },
    };

    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Main camera" }));

    await waitFor(() =>
      expect(mockAcquireWarmLocalVideoCapture).toHaveBeenCalled(),
    );
    expect(mockAcquireWarmLocalVideoCapture).toHaveBeenCalledWith(
      "source-1",
      expect.objectContaining({ deviceId: "capture-1" }),
      true,
      expect.stringContaining("slide-transmit:source-1:"),
    );

    const action = mockDispatch.mock.calls
      .map(([candidate]) => candidate)
      .find((candidate) => candidate?.type === "presentation/updateStream");
    expect(action.payload).toEqual(
      expect.objectContaining({
        outputIds: ["stream"],
        slide: videoSlide,
        type: "local-video-input",
        localVideoInput: expect.objectContaining({ sourceId: "source-1" }),
      }),
    );
    expect(
      mockDispatch.mock.calls.some(
        ([candidate]) => candidate?.type === "presentation/clearOutput",
      ),
    ).toBe(false);
  });

  it("releases its transmit consumer when another window owns capture", async () => {
    mockState.undoable.present.item.slides = [
      {
        id: "video-slide",
        type: "Media",
        name: "Main camera",
        boxes: [],
        mediaSource: {
          kind: "local-video-input",
          sourceId: "source-1",
          label: "Main camera",
        },
      },
    ];
    mockAcquireWarmLocalVideoCapture.mockRejectedValue(
      new LocalVideoCaptureOwnedError(),
    );

    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Main camera" }));

    await waitFor(() =>
      expect(mockReleaseWarmLocalVideoCapture).toHaveBeenCalledWith(
        "source-1",
        expect.stringContaining("slide-transmit:source-1:"),
      ),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "presentation/updateMonitor" }),
    );
  });

  it("sends one video-input slide to every selected display", async () => {
    const showToast = jest.fn(() => "toast-1");
    mockState.undoable.present.item.slides = [
      {
        id: "video-slide",
        type: "Media",
        name: "Main camera",
        boxes: [],
        mediaSource: {
          kind: "local-video-input",
          sourceId: "source-1",
          label: "Main camera",
        },
      },
    ];
    mockState.undoable.present.item.shouldSendTo = {
      projector: true,
      monitor: true,
      stream: false,
      outputIds: ["projector", "monitor"],
    };
    mockState.displayOutputs = {
      list: [
        {
          id: "projector",
          name: "Projector",
          type: "projector",
          enabled: true,
        },
        { id: "monitor", name: "Monitor", type: "monitor", enabled: true },
      ],
    };

    render(
      <ToastContext.Provider
        value={{ showToast, updateToast: jest.fn(), removeToast: jest.fn() }}
      >
        <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
          <ControllerInfoContext.Provider value={mockControllerInfoValue}>
            <ItemSlides />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </ToastContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Main camera" }));

    await waitFor(() =>
      expect(mockAcquireWarmLocalVideoCapture).toHaveBeenCalled(),
    );

    expect(showToast).not.toHaveBeenCalled();
    const actions = mockDispatch.mock.calls.map(([action]) => action);
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "presentation/updateProjector",
          payload: expect.objectContaining({ outputIds: ["projector"] }),
        }),
        expect.objectContaining({
          type: "presentation/updateMonitor",
          payload: expect.objectContaining({ outputIds: ["monitor"] }),
        }),
      ]),
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

  it("keeps Add, Copy, Clear background, and Delete on the toolbar for the focused slide", () => {
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
    expect(screen.queryByText("slides selected")).not.toBeInTheDocument();
  });

  it("hides Add and Copy during subset selection and keeps Clear, Delete, and Done", () => {
    mockState.undoable.present.item.backgroundTargetSlideIds = [
      "slide-1",
      "slide-2",
    ];

    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(screen.getByLabelText("2 slides selected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear background" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete (2)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy" }),
    ).not.toBeInTheDocument();
  });

  it("clears subset selection from Done", () => {
    mockState.undoable.present.item.backgroundTargetSlideIds = ["slide-1"];

    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "item/clearBackgroundTargetSelection",
      }),
    );
  });

  it("clears the focused slide background when no subset is selected", () => {
    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear background" }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "item/clearSlideBackgroundsOnSubset",
        payload: { slideIds: ["slide-1"] },
      }),
    );
  });

  it("clears backgrounds on the selected slides", () => {
    mockState.undoable.present.item.backgroundTargetSlideIds = [
      "slide-1",
      "slide-2",
    ];

    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear background" }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "item/clearSlideBackgroundsOnSubset",
        payload: { slideIds: ["slide-1", "slide-2"] },
      }),
    );
  });

  it("deletes the focused slide when no subset is selected", () => {
    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "item/removeSlidesByIds",
        payload: { slideIds: ["slide-1"] },
      }),
    );
  });

  it("deletes selected slides when at least one slide would remain", () => {
    mockState.undoable.present.item.slides = [
      ...baseSlides,
      {
        id: "slide-3",
        type: "Section",
        name: "Section 3",
        boxes: [
          { id: "bg-3", width: 100, height: 100 },
          { id: "text-3", words: "Third", width: 100, height: 50 },
        ],
      },
    ];
    mockState.undoable.present.item.backgroundTargetSlideIds = [
      "slide-1",
      "slide-2",
    ];

    render(
      <GlobalInfoContext.Provider value={mockGlobalInfoValue}>
        <ControllerInfoContext.Provider value={mockControllerInfoValue}>
          <ItemSlides />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete (2)" }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "item/removeSlidesByIds",
        payload: { slideIds: ["slide-1", "slide-2"] },
      }),
    );
  });
});
