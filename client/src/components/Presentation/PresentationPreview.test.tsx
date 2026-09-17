import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PresentationPreview from "./PresentationPreview";

const mockDisplayWindow = jest.fn((_: any) => (
  <div data-testid="display-window" />
));

jest.mock("../../hooks", () => ({
  useDispatch: () => jest.fn(),
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ undoable: { present: { overlays: { list: [] } } } }),
}));

jest.mock("../DisplayWindow/DisplayWindow", () => ({
  __esModule: true,
  default: (props: unknown) => mockDisplayWindow(props),
}));

const basePresentation = {
  displayType: "projector",
} as any;

const makeRect = (width: number) => ({
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  bottom: 0,
  right: width,
  width,
  height: 0,
  toJSON: () => ({}),
});

describe("PresentationPreview", () => {
  let headerWidth = 320;

  beforeEach(() => {
    mockDisplayWindow.mockClear();

    class ResizeObserverMock {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe() {
        this.callback([], this as unknown as ResizeObserver);
      }

      disconnect() {}
    }

    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      configurable: true,
      value: ResizeObserverMock,
    });

    jest
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute("data-measure") === "presentation-header") {
          return headerWidth;
        }
        if (this.getAttribute("data-testid") === "quick-link-rail-projector") {
          return 300;
        }
        return 0;
      });

    jest
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute("data-measure") === "presentation-title") {
          return 80;
        }
        return 0;
      });

    jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const measure = this.getAttribute("data-measure");
        if (measure === "presentation-clear-icon-width") {
          return makeRect(32) as DOMRect;
        }
        if (measure === "presentation-clear-label-width") {
          return makeRect(72) as DOMRect;
        }
        if (measure === "presentation-toggle-icon-width") {
          return makeRect(32) as DOMRect;
        }
        if (measure === "presentation-toggle-label-width") {
          return makeRect(88) as DOMRect;
        }
        if (this.getAttribute("data-quick-link-tile") === "true") {
          return { ...makeRect(0), height: 100 } as DOMRect;
        }
        return makeRect(0) as DOMRect;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows Clear and Live labels when the header has enough space", async () => {
    headerWidth = 320;

    render(
      <PresentationPreview
        name="Projector"
        outputId="projector"
        info={basePresentation}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    });
    expect(screen.getByRole("switch", { name: "Live:" })).toBeInTheDocument();
  });

  it("keeps Clear labeled before Live when space is limited", async () => {
    headerWidth = 220;

    render(
      <PresentationPreview
        name="Projector"
        outputId="projector"
        info={basePresentation}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("switch", { name: "Live:" }),
    ).not.toBeInTheDocument();
  });

  it("hides both labels when the header is too narrow", async () => {
    headerWidth = 160;

    render(
      <PresentationPreview
        name="Projector"
        outputId="projector"
        info={basePresentation}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
      />,
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Clear" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.queryByRole("switch", { name: "Live:" }),
    ).not.toBeInTheDocument();
  });

  it("uses full monitor layout only for monitor previews", () => {
    render(
      <PresentationPreview
        name="Monitor"
        outputId="monitor"
        info={{ ...basePresentation, displayType: "monitor" }}
        prevInfo={{ ...basePresentation, displayType: "monitor" }}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
      />,
    );

    expect(mockDisplayWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        displayType: "monitor",
        monitorLayoutMode: "full-monitor",
      }),
    );
  });

  it("keeps non-monitor previews in content-only mode", () => {
    render(
      <PresentationPreview
        name="Projector"
        outputId="projector"
        info={basePresentation}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
      />,
    );

    expect(mockDisplayWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        displayType: "projector",
        monitorLayoutMode: "content-only",
      }),
    );
  });

  it("uses the high-quality local video path so booth tiles mirror live output", () => {
    render(
      <PresentationPreview
        name="Projector"
        outputId="projector"
        info={basePresentation}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
      />,
    );

    expect(mockDisplayWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        canCaptureLocalVideo: true,
        directLocalVideoCapture: true,
        playLocalVideoAudio: false,
      }),
    );
  });

  it("keeps DisplayWindow mounted while hidden and only gates expensive playback flags", () => {
    const { rerender } = render(
      <PresentationPreview
        name="Projector"
        outputId="projector"
        info={basePresentation}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
        isVisible={false}
      />,
    );

    expect(screen.getByTestId("display-window")).toBeInTheDocument();
    expect(mockDisplayWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        shouldAnimate: false,
        shouldPlayVideo: true,
        suspendVideoPlayback: true,
        videoPreloadRole: "preview",
        canCaptureLocalVideo: false,
        directLocalVideoCapture: false,
      }),
    );

    const nextInfo = {
      ...basePresentation,
      time: 42,
    } as typeof basePresentation;

    rerender(
      <PresentationPreview
        name="Projector"
        outputId="projector"
        info={nextInfo}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
        isVisible
      />,
    );

    expect(screen.getByTestId("display-window")).toBeInTheDocument();
    expect(mockDisplayWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({
        time: 42,
        shouldAnimate: true,
        shouldPlayVideo: true,
        suspendVideoPlayback: false,
        videoPreloadRole: "preview",
        canCaptureLocalVideo: true,
        directLocalVideoCapture: true,
      }),
    );
  });

  it("keeps the highest-priority links visible and puts the rest in overflow", async () => {
    const user = userEvent.setup();
    render(
      <PresentationPreview
        name="Projector"
        outputId="projector"
        info={basePresentation}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[
          { id: "q1", label: "Link 1", action: "slide" },
          { id: "q2", label: "Link 2", action: "slide" },
          { id: "q3", label: "Link 3", action: "slide" },
          { id: "q4", label: "Link 4", action: "slide" },
          { id: "q5", label: "Link 5", action: "slide" },
          { id: "q6", label: "Link 6", action: "slide" },
        ] as never[]}
        timers={[]}
      />,
    );

    expect(screen.getByTestId("quick-link-rail-projector")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link 2" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link 3" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link 4" })).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Show 5 more Quick Links" }),
    );

    expect(screen.getByRole("button", { name: "Link 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link 4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link 5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link 6" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Link 2" })).toHaveLength(1);
  });

  it("does not render an overflow control when all links fit", () => {
    render(
      <PresentationPreview
        name="Projector"
        outputId="projector"
        info={basePresentation}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[{ id: "q1", label: "Only link", action: "slide" }] as never[]}
        timers={[]}
      />,
    );

    expect(screen.getByRole("button", { name: "Only link" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show .* more Quick Links/ })).not.toBeInTheDocument();
  });
});
