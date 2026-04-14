import { render } from "@testing-library/react";
import { useGSAP } from "@gsap/react";
import DisplayStbOverlay from "../DisplayStbOverlay";

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
    getProperty: jest.fn((_: unknown, property: string) => {
      if (property === "opacity") return 0.4;
      if (property === "yPercent") return 30;
      return 0;
    }),
  },
}));

jest.mock("@gsap/react", () => ({
  useGSAP: jest.fn(),
}));

jest.mock("../SharedOverlay", () => ({
  __esModule: true,
  default: require("react").forwardRef((_props: any, ref: any) => (
    <div ref={ref} data-testid="shared-overlay-mock" />
  )),
}));

describe("DisplayStbOverlay", () => {
  const gsapCallbacks: Array<() => void> = [];

  beforeEach(() => {
    jest.clearAllMocks();
    gsapCallbacks.length = 0;
    (useGSAP as jest.Mock).mockImplementation((cb: () => void) => {
      gsapCallbacks.push(cb);
    });
  });

  it("keeps the previous STB overlay visible when the current type has switched away", () => {
    const containerRef = { current: document.createElement("div") };

    render(
      <DisplayStbOverlay
        ref={containerRef as any}
        width={30}
        shouldAnimate
        stbOverlayInfo={{ id: "stb-current" }}
        prevStbOverlayInfo={{
          id: "stb-prev",
          type: "stick-to-bottom",
          heading: "Welcome",
        }}
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

    expect(
      gsapSetMock.mock.calls.some(
        ([, props]) => props?.yPercent === 0 && props?.opacity === 1,
      ),
    ).toBe(true);
    expect(gsapToMock).toHaveBeenCalled();
  });

  it("builds STB enter and exit animations for active overlay content", () => {
    const containerRef = { current: document.createElement("div") };

    render(
      <DisplayStbOverlay
        ref={containerRef as any}
        width={30}
        shouldAnimate
        stbOverlayInfo={{
          id: "stb-current",
          type: "stick-to-bottom",
          heading: "Welcome",
          duration: 3,
        }}
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

    expect(
      gsapSetMock.mock.calls.some(
        ([, props]) => props?.yPercent === 120 && props?.opacity === 0,
      ),
    ).toBe(true);
    expect(
      gsapToMock.mock.calls.some(
        ([, props]) => props?.yPercent === 0 && props?.opacity === 1,
      ),
    ).toBe(true);
    expect(
      gsapToMock.mock.calls.some(
        ([, props]) =>
          props?.yPercent === 120 &&
          props?.opacity === 0 &&
          props?.delay === 3,
      ),
    ).toBe(true);
  });

  it("keeps current overlay dependencies stable when no previous overlay is provided", () => {
    const overlayInfo = {
      id: "stb-stable",
      type: "stick-to-bottom" as const,
      heading: "Welcome",
    };

    const { rerender } = render(
      <DisplayStbOverlay width={30} stbOverlayInfo={overlayInfo} />,
    );

    const firstCurrentConfig = (useGSAP as jest.Mock).mock.calls[0][1];

    rerender(<DisplayStbOverlay width={30} stbOverlayInfo={overlayInfo} />);

    const secondCurrentConfig = (useGSAP as jest.Mock).mock.calls[2][1];

    expect(firstCurrentConfig.dependencies).toEqual([overlayInfo]);
    expect(secondCurrentConfig.dependencies).toEqual([overlayInfo]);
  });
});
