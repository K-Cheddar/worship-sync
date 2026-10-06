import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PresentationPreview from "./PresentationPreview";
import ErrorBoundary from "../ErrorBoundary/ErrorBoundary";

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
  let previewColumnHeight = 240;
  let measuredQuickLinkHeight = 64;
  let measuredOverflowButtonHeight = 48;
  let triggerResizeObservers = () => {};
  let quickLinkTileMeasurements = 0;

  beforeEach(() => {
    mockDisplayWindow.mockClear();
    headerWidth = 320;
    previewColumnHeight = 240;
    measuredQuickLinkHeight = 64;
    measuredOverflowButtonHeight = 48;
    quickLinkTileMeasurements = 0;
    const observers: Array<{ trigger: () => void }> = [];

    class ResizeObserverMock {
      private readonly callback: ResizeObserverCallback;
      private active = true;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observers.push({
          trigger: () => {
            if (this.active) {
              this.callback([], this as unknown as ResizeObserver);
            }
          },
        });
      }

      observe() {
        this.callback([], this as unknown as ResizeObserver);
      }

      disconnect() {
        this.active = false;
      }
    }
    triggerResizeObservers = () => observers.forEach(({ trigger }) => trigger());

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
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute("data-measure") === "presentation-preview-column") {
          return previewColumnHeight;
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
        if (measure === "quick-link-tile") {
          return { ...makeRect(0), height: measuredQuickLinkHeight } as DOMRect;
        }
        if (measure === "quick-link-overflow-button") {
          return {
            ...makeRect(0),
            height: measuredOverflowButtonHeight,
          } as DOMRect;
        }
        if (this.getAttribute("data-quick-link-tile") === "true") {
          quickLinkTileMeasurements += 1;
          const label = this.textContent ?? "";
          const height = label.includes("Link 3")
            ? 180
            : label.includes("Link 2")
              ? 80
              : 60;
          return { ...makeRect(0), height } as DOMRect;
        }
        return makeRect(0) as DOMRect;
      });

    const getComputedStyle = window.getComputedStyle.bind(window);
    jest.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = getComputedStyle(element);
      if (!element.getAttribute("data-testid")?.startsWith("quick-link-rail-")) {
        return style;
      }

      return new Proxy(style, {
        get(target, property) {
          if (
            property === "paddingTop" ||
            property === "paddingBottom" ||
            property === "rowGap"
          ) {
            return "4px";
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
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

  it("centers a fixed-size preview and caps it to its available stage width", () => {
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
        hideQuickLinks
        centerPreview
      />,
    );

    expect(screen.getByTestId("content-hidden-preview-stage")).toHaveClass(
      "flex",
      "w-full",
      "min-w-0",
      "justify-center",
    );
    expect(mockDisplayWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({
        width: 14,
        className: "max-w-full",
      }),
    );
  });

  it("keeps the centered preview width when quick links are hidden", () => {
    render(
      <PresentationPreview
        name="Stream"
        outputId="stream"
        info={{ ...basePresentation, displayType: "stream" }}
        prevInfo={{ ...basePresentation, displayType: "stream" }}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
        hideQuickLinks
        centerPreview
        previewScale={1.875}
      />,
    );

    expect(mockDisplayWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({
        width: 26.25,
        className: "max-w-full",
      }),
    );
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

  it("shows only the eye control and reveals Content hidden from its popover", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PresentationPreview
        name="Lobby Stream"
        outputId="out_lobby_stream"
        info={{
          ...basePresentation,
          displayType: "stream",
          participantOverlayInfo: { id: "overlay", name: "Name", time: 1 },
        }}
        prevInfo={basePresentation}
        isTransmitting
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
        streamItemContentBlocked
        showContentHiddenIndicator
      />,
    );

    const badge = screen.getByRole("button", { name: "Content hidden on Lobby Stream" });
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute(
      "aria-describedby",
      expect.any(String),
    );
    expect(screen.queryByText(/Content Hidden.*Lobby Stream/)).not.toBeInTheDocument();
    expect(screen.getByTestId("content-hidden-preview-stage")).toHaveClass(
      "@container/preview",
      "isolate",
    );
    expect(screen.getByTestId("content-hidden-preview-badge")).toHaveClass("z-10");

    await user.click(badge);
    expect(screen.getByText("Content hidden")).toBeInTheDocument();
    expect(screen.getByText("Confirmed active Hide Content state for Lobby Stream.")).toBeInTheDocument();
    expect(screen.getByTestId("content-hidden-preview-popover")).toHaveClass("border-0");

    rerender(
      <PresentationPreview
        name="Lobby Stream"
        outputId="out_lobby_stream"
        info={{ ...basePresentation, displayType: "stream" }}
        prevInfo={basePresentation}
        isTransmitting
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
        streamItemContentBlocked={false}
        showContentHiddenIndicator
      />,
    );
    expect(screen.queryByRole("button", { name: "Content hidden on Lobby Stream" })).not.toBeInTheDocument();
  });

  it("keeps a compact accessible badge when hidden state is unconfirmed", async () => {
    render(
      <PresentationPreview
        name="Lobby Stream"
        outputId="out_lobby_stream"
        info={{ ...basePresentation, displayType: "stream" }}
        prevInfo={basePresentation}
        isTransmitting
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
        streamItemContentBlocked
        showContentHiddenIndicator
        contentHiddenUnconfirmed
      />,
    );

    const badge = screen.getByRole("button", { name: "Content hidden on Lobby Stream" });
    expect(badge).toHaveAttribute("aria-describedby", expect.any(String));
    expect(badge).toHaveClass("border-dashed");
    expect(screen.getByTestId("content-hidden-preview-badge")).toBeInTheDocument();
    expect(screen.queryByText(/Content Hidden.*Offline.*Lobby Stream/)).not.toBeInTheDocument();

    await userEvent.setup().click(badge);
    expect(
      screen.getByText(
        "Last known hidden state for Lobby Stream; the remote stream state is unconfirmed while offline.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the reconnection sync explanation discoverable from the eye control", async () => {
    const user = userEvent.setup();
    render(
      <PresentationPreview
        name="Lobby Stream"
        outputId="out_lobby_stream"
        info={{ ...basePresentation, displayType: "stream" }}
        prevInfo={basePresentation}
        isTransmitting
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
        streamItemContentBlocked
        showContentHiddenIndicator
        contentHiddenUnconfirmed
        contentHiddenUnconfirmedLabel="Syncing"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Content hidden on Lobby Stream" }));
    expect(screen.getByRole("button", { name: "Content hidden on Lobby Stream" })).toHaveAccessibleDescription(
      "Last known hidden state for Lobby Stream; the remote stream state is unconfirmed while syncing.",
    );
  });

  it("keeps the explanation discoverable when a focused preview omits its header", () => {
    render(
      <PresentationPreview
        name="Lobby Stream"
        outputId="out_lobby_stream"
        info={{ ...basePresentation, displayType: "stream" }}
        prevInfo={basePresentation}
        isTransmitting
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
        streamItemContentBlocked
        showContentHiddenIndicator
        hideHeader
        contentHiddenUnconfirmed
        contentHiddenUnconfirmedLabel="Syncing"
      />,
    );

    expect(screen.queryByText(/Content Hidden.*Syncing.*Lobby Stream/)).not.toBeInTheDocument();
  });

  it("does not show the badge for overlay-only hiding or non-stream displays", () => {
    const { rerender } = render(
      <PresentationPreview
        name="Stream"
        outputId="stream"
        info={{
          ...basePresentation,
          displayType: "stream",
          participantOverlayInfo: { id: "overlay", name: "Name", time: 1 },
        }}
        prevInfo={basePresentation}
        isTransmitting
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
        streamItemContentBlocked={false}
        showContentHiddenIndicator
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(
      <PresentationPreview
        name="Projector"
        outputId="projector"
        info={{ ...basePresentation, displayType: "projector" }}
        prevInfo={basePresentation}
        isTransmitting
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
        streamItemContentBlocked
        showContentHiddenIndicator
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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

  it("updates Clear and Live labels across responsive resize boundaries", () => {
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

    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Live:" })).toBeInTheDocument();

    headerWidth = 220;
    act(() => triggerResizeObservers());
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Live:" })).not.toBeInTheDocument();

    headerWidth = 160;
    act(() => triggerResizeObservers());
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Live:" })).not.toBeInTheDocument();

    headerWidth = 320;
    act(() => triggerResizeObservers());
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Live:" })).toBeInTheDocument();
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

  it("deep-suspends long-hidden preview media and restores the latest state", () => {
    jest.useFakeTimers();
    try {
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

      expect(mockDisplayWindow).toHaveBeenLastCalledWith(
        expect.objectContaining({
          shouldPlayVideo: true,
          suspendVideoPlayback: true,
        }),
      );

      act(() => {
        jest.advanceTimersByTime(30_000);
      });

      expect(screen.getByTestId("display-window")).toBeInTheDocument();
      expect(mockDisplayWindow).toHaveBeenLastCalledWith(
        expect.objectContaining({
          shouldPlayVideo: false,
          suspendVideoPlayback: true,
          canCaptureLocalVideo: false,
        }),
      );

      const latestInfo = { ...basePresentation, time: 84 } as typeof basePresentation;
      rerender(
        <PresentationPreview
          name="Projector"
          outputId="projector"
          info={latestInfo}
          prevInfo={basePresentation}
          isTransmitting={false}
          toggleIsTransmitting={jest.fn()}
          quickLinks={[]}
          timers={[]}
          isVisible
        />,
      );

      expect(mockDisplayWindow).toHaveBeenLastCalledWith(
        expect.objectContaining({
          time: 84,
          shouldPlayVideo: true,
          suspendVideoPlayback: false,
          canCaptureLocalVideo: true,
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("deep-suspends immediately when the controller renderer becomes hidden", () => {
    const originalVisibilityState = document.visibilityState;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    try {
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
          isVisible
        />,
      );

      expect(mockDisplayWindow).toHaveBeenLastCalledWith(
        expect.objectContaining({
          shouldPlayVideo: false,
          suspendVideoPlayback: true,
          canCaptureLocalVideo: false,
        }),
      );
    } finally {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: originalVisibilityState,
      });
      act(() => document.dispatchEvent(new Event("visibilitychange")));
    }
  });

  it("accepts an external request to deep-suspend preview-only media", () => {
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
        suspendPreviewMedia
      />,
    );

    expect(mockDisplayWindow).toHaveBeenLastCalledWith(
      expect.objectContaining({
        shouldPlayVideo: false,
        suspendVideoPlayback: true,
        canCaptureLocalVideo: false,
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
    expect(screen.getByRole("button", { name: "Link 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link 3" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link 4" })).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Show 4 more Quick Links" }),
    );

    expect(screen.getByRole("button", { name: "Link 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link 4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link 5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link 6" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Link 2" })).toHaveLength(1);
  });

  it("uses stable geometry and stays settled across repeated resize boundaries", async () => {
    const links = [1, 2, 3, 4, 5, 6].map((number) => ({
      id: `q${number}`,
      label: `Link ${number}`,
      action: "slide",
    }));
    render(
      <ErrorBoundary fallback={<div>Transmit preview failed</div>}>
        <PresentationPreview
          name="Projector"
          outputId="projector"
          info={basePresentation}
          prevInfo={basePresentation}
          isTransmitting={false}
          toggleIsTransmitting={jest.fn()}
          quickLinks={links as never[]}
          timers={[]}
        />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("button", { name: "Show 4 more Quick Links" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link 1" })).toBeInTheDocument();
    expect(quickLinkTileMeasurements).toBe(0);

    previewColumnHeight = 150;
    act(() => triggerResizeObservers());
    expect(screen.getByRole("button", { name: "Show 5 more Quick Links" })).toBeInTheDocument();

    previewColumnHeight = 270;
    act(() => triggerResizeObservers());
    expect(screen.getByRole("button", { name: "Show 3 more Quick Links" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link 3" })).toBeInTheDocument();

    previewColumnHeight = 150;
    const triggerResize = triggerResizeObservers;
    for (let index = 0; index < 20; index += 1) {
      act(() => triggerResize());
      expect(screen.getByRole("button", { name: "Show 5 more Quick Links" })).toBeInTheDocument();
    }

    expect(quickLinkTileMeasurements).toBe(0);
    expect(mockDisplayWindow.mock.calls.length).toBeLessThan(12);
    expect(screen.queryByText("Transmit preview failed")).not.toBeInTheDocument();
  });

  it("clamps compact labels to two natural lines without reserving 40px", () => {
    const label = "A longer Quick Link label that should wrap cleanly";
    render(
      <PresentationPreview
        name="Projector"
        outputId="projector"
        info={basePresentation}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[{ id: "q1", label, action: "slide" }] as never[]}
        timers={[]}
      />,
    );

    const compactLabel = screen.getByText(label);
    expect(compactLabel).toHaveClass("line-clamp-2", "leading-tight", "px-0.5");
    expect(compactLabel).not.toHaveClass("h-10");
    expect(compactLabel).toHaveStyle({
      fontSize: "clamp(0.45rem, 0.55vw, 0.65rem)",
    });
  });

  it("shows every Quick Link when the full tile stack fits", () => {
    const links = [1, 2, 3].map((number) => ({
      id: `q${number}`,
      label: `Link ${number}`,
      action: "slide",
    }));
    render(
      <PresentationPreview
        name="Projector"
        outputId="projector"
        info={basePresentation}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={links as never[]}
        timers={[]}
      />,
    );

    for (const link of links) {
      expect(screen.getByRole("button", { name: link.label })).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: /Show .* more Quick Links/ }),
    ).not.toBeInTheDocument();
  });

  it("fits two links beside the measured overflow button when three tiles do not fit", () => {
    previewColumnHeight = 198;
    const links = [1, 2, 3].map((number) => ({
      id: `q${number}`,
      label: `Link ${number}`,
      action: "slide",
    }));
    render(
      <PresentationPreview
        name="Projector"
        outputId="projector"
        info={basePresentation}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={links as never[]}
        timers={[]}
      />,
    );

    expect(screen.getByRole("button", { name: "Link 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link 3" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show 1 more Quick Links" }),
    ).toBeInTheDocument();
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
