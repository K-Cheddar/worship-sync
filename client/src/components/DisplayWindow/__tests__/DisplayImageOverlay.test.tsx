import { act, render, screen } from "@testing-library/react";
import DisplayImageOverlay from "../DisplayImageOverlay";
import { useGSAP } from "@gsap/react";

const gsapGetPropertyMock = jest.fn(() => 0.4);
const gsapSetMock = jest.fn();
const gsapToMock = jest.fn();
const timelineMock = {
  set: (...args: any[]) => {
    gsapSetMock(...args);
    return timelineMock;
  },
  to: (...args: any[]) => {
    gsapToMock(...args);
    return timelineMock;
  },
  clear: jest.fn(),
};

jest.mock("gsap", () => ({
  __esModule: true,
  default: {
    timeline: jest.fn(() => timelineMock),
    getProperty: (...args: any[]) =>
      gsapGetPropertyMock.apply(undefined, args) as number,
  },
}));

const mockSharedOverlay = jest.fn(
  ({ overlayInfo, needsPadding, shouldFillContainer, isPrev }) => (
    <div
      data-testid="shared-overlay-mock"
      data-name={overlayInfo?.name || ""}
      data-needs-padding={needsPadding ? "true" : "false"}
      data-fill={shouldFillContainer ? "true" : "false"}
      data-prev={isPrev ? "true" : "false"}
    />
  ),
);

jest.mock("../../../utils/generalUtils", () => ({
  checkMediaType: jest.fn((url: string) => (url.endsWith(".mp4") ? "video" : "image")),
}));

jest.mock("@gsap/react", () => ({
  useGSAP: jest.fn(),
}));

jest.mock("../SharedOverlay", () => ({
  __esModule: true,
  default: require("react").forwardRef((props: any, ref: any) => (
    <div ref={ref}>{mockSharedOverlay(props)}</div>
  )),
}));

describe("DisplayImageOverlay", () => {
  const gsapCallbacks: Array<() => void> = [];
  const originalImage = global.Image;
  let imageInstances: Array<{
    complete: boolean;
    naturalWidth: number;
    onload: null | (() => void);
    onerror: null | (() => void);
    src: string;
  }>;

  beforeEach(() => {
    jest.clearAllMocks();
    gsapCallbacks.length = 0;
    imageInstances = [];
    global.Image = class MockImage {
      complete = false;
      naturalWidth = 0;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      private _src = "";

      constructor() {
        imageInstances.push(this as unknown as (typeof imageInstances)[number]);
      }

      get src() {
        return this._src;
      }

      set src(value: string) {
        this._src = value;
      }
    } as unknown as typeof Image;
    (useGSAP as jest.Mock).mockImplementation((cb: () => void) => {
      gsapCallbacks.push(cb);
    });
  });

  afterEach(() => {
    global.Image = originalImage;
  });

  it("renders current and previous overlays by default", () => {
    render(
      <DisplayImageOverlay
        width={30}
        imageOverlayInfo={{ id: "img-1", name: "Current", imageUrl: "https://cdn/current.jpg" }}
        prevImageOverlayInfo={{
          id: "img-0",
          name: "Previous",
          imageUrl: "https://cdn/previous.jpg",
        }}
      />,
    );

    const overlays = screen.getAllByTestId("shared-overlay-mock");
    expect(overlays).toHaveLength(2);
    expect(overlays[0]).toHaveAttribute("data-name", "Current");
    expect(overlays[1]).toHaveAttribute("data-name", "Previous");
    expect(overlays[0]).toHaveAttribute("data-needs-padding", "true");
    expect(overlays[1]).toHaveAttribute("data-prev", "true");
  });

  it("renders only current overlay when shouldFillContainer is true", () => {
    render(
      <DisplayImageOverlay
        width={30}
        shouldFillContainer
        imageOverlayInfo={{ id: "img-1", name: "Current", imageUrl: "https://cdn/current.jpg" }}
        prevImageOverlayInfo={{
          id: "img-0",
          name: "Previous",
          imageUrl: "https://cdn/previous.jpg",
        }}
      />,
    );

    const overlays = screen.getAllByTestId("shared-overlay-mock");
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toHaveAttribute("data-fill", "true");
  });

  it("builds animation timelines when shouldAnimate is true and image urls exist", () => {
    const containerRef = { current: document.createElement("div") };
    render(
      <DisplayImageOverlay
        ref={containerRef as any}
        width={30}
        shouldAnimate
        imageOverlayInfo={{
          id: "img-1",
          name: "Current",
          imageUrl: "https://cdn/current.jpg",
          duration: 2,
        }}
        prevImageOverlayInfo={{
          id: "img-0",
          name: "Previous",
          imageUrl: "https://cdn/previous.mp4",
        }}
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

    expect(gsapSetMock).toHaveBeenCalled();
    expect(gsapToMock).toHaveBeenCalled();
  });

  it("keeps the previous image overlay visible when the current type has switched away", () => {
    const containerRef = { current: document.createElement("div") };
    render(
      <DisplayImageOverlay
        ref={containerRef as any}
        width={30}
        shouldAnimate
        imageOverlayInfo={{ id: "img-current" }}
        prevImageOverlayInfo={{
          id: "img-prev",
          name: "Previous",
          imageUrl: "https://cdn/previous.jpg",
        }}
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

    expect(
      gsapSetMock.mock.calls.some(([, props]) => props?.opacity === 1),
    ).toBe(true);
    expect(gsapToMock).toHaveBeenCalled();
  });

  it("keeps a previous video overlay visible when switching away to a different overlay type", () => {
    const containerRef = { current: document.createElement("div") };
    render(
      <DisplayImageOverlay
        ref={containerRef as any}
        width={30}
        shouldAnimate
        imageOverlayInfo={{ id: "video-current" }}
        prevImageOverlayInfo={{
          id: "video-prev",
          name: "Previous Video",
          imageUrl: "https://cdn/previous.mp4",
        }}
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

    expect(
      gsapSetMock.mock.calls.some(([, props]) => props?.opacity === 1),
    ).toBe(true);
    expect(gsapToMock).toHaveBeenCalled();
  });

  it("starts local keep-alive only after the current image is locally ready to animate", () => {
    const containerRef = { current: document.createElement("div") };
    const onLocalKeepAliveStart = jest.fn();

    render(
      <DisplayImageOverlay
        ref={containerRef as any}
        width={30}
        shouldAnimate
        currentKeepAliveKey="image::current"
        currentKeepAliveMs={5000}
        onLocalKeepAliveStart={onLocalKeepAliveStart}
        imageOverlayInfo={{
          id: "img-1",
          name: "Current",
          imageUrl: "https://cdn/current.jpg",
          duration: 2,
        }}
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

    expect(onLocalKeepAliveStart).not.toHaveBeenCalled();

    act(() => {
      imageInstances[0].naturalWidth = 1920;
      imageInstances[0].complete = true;
      imageInstances[0].onload?.();
    });

    gsapCallbacks.slice(1).forEach((cb) => cb());

    expect(onLocalKeepAliveStart).toHaveBeenCalledWith(
      "image::current",
      5000,
      "max",
    );
  });

  it("keeps current overlay dependencies stable when no previous overlay is provided", () => {
    const overlayInfo = {
      id: "img-stable",
      name: "Stable",
      imageUrl: "https://cdn/stable.jpg",
    };

    const { rerender } = render(
      <DisplayImageOverlay width={30} imageOverlayInfo={overlayInfo} />,
    );

    const firstCurrentConfig = (useGSAP as jest.Mock).mock.calls[0][1];

    rerender(<DisplayImageOverlay width={30} imageOverlayInfo={overlayInfo} />);

    const secondCurrentConfig = (useGSAP as jest.Mock).mock.calls[2][1];

    expect(firstCurrentConfig.dependencies).toEqual([
      undefined,
      undefined,
      overlayInfo,
      undefined,
      undefined,
    ]);
    expect(secondCurrentConfig.dependencies).toEqual([
      undefined,
      undefined,
      overlayInfo,
      undefined,
      undefined,
    ]);
  });
});
