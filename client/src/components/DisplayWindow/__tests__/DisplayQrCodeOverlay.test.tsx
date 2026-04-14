import { render } from "@testing-library/react";
import { useGSAP } from "@gsap/react";
import DisplayQrCodeOverlay from "../DisplayQrCodeOverlay";

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

describe("DisplayQrCodeOverlay", () => {
  const gsapCallbacks: Array<() => void> = [];

  beforeEach(() => {
    jest.clearAllMocks();
    gsapCallbacks.length = 0;
    (useGSAP as jest.Mock).mockImplementation((cb: () => void) => {
      gsapCallbacks.push(cb);
    });
  });

  it("keeps the previous QR overlay visible when the current type has switched away", () => {
    const containerRef = { current: document.createElement("div") };

    render(
      <DisplayQrCodeOverlay
        ref={containerRef as any}
        width={30}
        shouldAnimate
        qrCodeOverlayInfo={{ id: "qr-current" }}
        prevQrCodeOverlayInfo={{
          id: "qr-prev",
          type: "qr-code",
          url: "https://example.com",
          description: "Scan here",
        }}
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

    expect(
      gsapSetMock.mock.calls.some(([, props]) => props?.opacity === 1),
    ).toBe(true);
    expect(gsapToMock).toHaveBeenCalled();
  });

  it("keeps current overlay dependencies stable when no previous overlay is provided", () => {
    const overlayInfo = {
      id: "qr-stable",
      type: "qr-code" as const,
      url: "https://example.com",
    };

    const { rerender } = render(
      <DisplayQrCodeOverlay width={30} qrCodeOverlayInfo={overlayInfo} />,
    );

    const firstCurrentConfig = (useGSAP as jest.Mock).mock.calls[0][1];

    rerender(
      <DisplayQrCodeOverlay width={30} qrCodeOverlayInfo={overlayInfo} />,
    );

    const secondCurrentConfig = (useGSAP as jest.Mock).mock.calls[2][1];

    expect(firstCurrentConfig.dependencies).toEqual([overlayInfo]);
    expect(secondCurrentConfig.dependencies).toEqual([overlayInfo]);
  });
});
