import { render, screen, waitFor } from "@testing-library/react";
import PresentationPreview from "./PresentationPreview";

const mockDisplayWindow = jest.fn((_: any) => <div data-testid="display-window" />);

jest.mock("../../hooks", () => ({
  useDispatch: () => jest.fn(),
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
        info={basePresentation}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
      />
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
        info={basePresentation}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("switch", { name: "Live:" })).not.toBeInTheDocument();
  });

  it("hides both labels when the header is too narrow", async () => {
    headerWidth = 160;

    render(
      <PresentationPreview
        name="Projector"
        info={basePresentation}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
      />
    );

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("switch", { name: "Live:" })).not.toBeInTheDocument();
  });

  it("uses full monitor layout only for monitor previews", () => {
    render(
      <PresentationPreview
        name="Monitor"
        info={{ ...basePresentation, displayType: "monitor" }}
        prevInfo={{ ...basePresentation, displayType: "monitor" }}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
      />
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
        info={basePresentation}
        prevInfo={basePresentation}
        isTransmitting={false}
        toggleIsTransmitting={jest.fn()}
        quickLinks={[]}
        timers={[]}
      />
    );

    expect(mockDisplayWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        displayType: "projector",
        monitorLayoutMode: "content-only",
      }),
    );
  });
});
