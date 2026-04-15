import { render, screen } from "@testing-library/react";
import { useGSAP } from "@gsap/react";
import DisplayParticipantOverlay from "../DisplayParticipantOverlay";

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
      if (property === "xPercent") return -20;
      return 0;
    }),
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
  checkMediaType: jest.fn(() => "image"),
  getImageFromVideoUrl: jest.fn((url: string) => url),
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

describe("DisplayParticipantOverlay", () => {
  const gsapCallbacks: Array<() => void> = [];
  const defaultParticipantInfo = {
    id: "p1",
    type: "participant" as const,
    name: "Test Name",
    title: "Test Title",
    formatting: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    gsapCallbacks.length = 0;
    (useGSAP as jest.Mock).mockImplementation((cb: () => void) => {
      gsapCallbacks.push(cb);
    });
  });

  it("renders only one overlay (current) when shouldFillContainer is true", () => {
    render(
      <div style={{ position: "relative", width: 400, height: 300 }}>
        <DisplayParticipantOverlay
          width={25}
          participantOverlayInfo={defaultParticipantInfo}
          prevParticipantOverlayInfo={{}}
          shouldFillContainer
        />
      </div>,
    );

    const overlayDivs = screen.getAllByTestId("shared-overlay-mock");
    expect(overlayDivs).toHaveLength(1);
    expect(overlayDivs[0]).toHaveAttribute("data-name", "Test Name");
  });

  it("renders current and prev overlay when shouldFillContainer is false and prev has data", () => {
    render(
      <div style={{ position: "relative", width: 400, height: 300 }}>
        <DisplayParticipantOverlay
          width={25}
          participantOverlayInfo={defaultParticipantInfo}
          prevParticipantOverlayInfo={{
            id: "prev-id",
            name: "Previous Name",
          }}
          shouldFillContainer={false}
        />
      </div>,
    );

    expect(screen.getAllByTestId("shared-overlay-mock")).toHaveLength(2);
  });

  it("does not mount a z-index prev layer when current is hidden by expiry and prev slot has no lines (same props shape as after clear)", () => {
    render(
      <div style={{ position: "relative", width: 400, height: 300 }}>
        <DisplayParticipantOverlay
          width={25}
          participantOverlayInfo={undefined}
          prevParticipantOverlayInfo={{
            id: "p-empty",
            name: "",
            title: "",
            event: "",
            time: Date.now(),
          }}
          shouldFillContainer={false}
        />
      </div>,
    );

    const overlays = screen.getAllByTestId("shared-overlay-mock");
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toHaveAttribute("data-prev", "false");
  });

  it("keeps the previous participant overlay visible when the current type has switched away", () => {
    const containerRef = { current: document.createElement("div") };

    render(
      <DisplayParticipantOverlay
        ref={containerRef as any}
        width={25}
        shouldAnimate
        participantOverlayInfo={{}}
        prevParticipantOverlayInfo={{
          id: "prev-p",
          type: "participant",
          name: "Previous Speaker",
          formatting: {
            participantOverlayPosition: "center",
          },
        }}
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

    expect(
      gsapSetMock.mock.calls.some(
        ([, props]) => props?.opacity === 1 && props?.xPercent === -50,
      ),
    ).toBe(true);
    expect(gsapToMock).toHaveBeenCalled();
  });

  it("builds centered participant enter and exit animations", () => {
    const containerRef = { current: document.createElement("div") };

    render(
      <DisplayParticipantOverlay
        ref={containerRef as any}
        width={25}
        shouldAnimate
        participantOverlayInfo={{
          id: "current-p",
          type: "participant",
          name: "Centered Speaker",
          duration: 1,
          formatting: {
            participantOverlayPosition: "center",
          },
        }}
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

    expect(
      gsapSetMock.mock.calls.some(
        ([, props]) => props?.opacity === 0 && props?.xPercent === -50,
      ),
    ).toBe(true);
    expect(
      gsapToMock.mock.calls.some(
        ([, props]) => props?.opacity === 1 && props?.duration === 2.5,
      ),
    ).toBe(true);
    expect(
      gsapToMock.mock.calls.some(
        ([, props]) => props?.opacity === 0 && props?.delay === 1,
      ),
    ).toBe(true);
  });

  it("builds side participant animations using xPercent movement", () => {
    const containerRef = { current: document.createElement("div") };

    render(
      <DisplayParticipantOverlay
        ref={containerRef as any}
        width={25}
        shouldAnimate
        participantOverlayInfo={{
          id: "right-p",
          type: "participant",
          name: "Right Speaker",
          duration: 2,
          formatting: {
            participantOverlayPosition: "right",
          },
        }}
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

    expect(
      gsapSetMock.mock.calls.some(
        ([, props]) => props?.opacity === 0 && props?.xPercent === 105,
      ),
    ).toBe(true);
    expect(
      gsapToMock.mock.calls.some(
        ([, props]) => props?.xPercent === 0 && props?.opacity === 1,
      ),
    ).toBe(true);
    expect(
      gsapToMock.mock.calls.some(
        ([, props]) => props?.xPercent === 105 && props?.opacity === 0,
      ),
    ).toBe(true);
  });

  it("keeps current overlay dependencies stable when no previous overlay is provided", () => {
    const overlayInfo = {
      id: "stable-p",
      type: "participant" as const,
      name: "Stable Speaker",
      formatting: {},
    };

    const { rerender } = render(
      <DisplayParticipantOverlay width={25} participantOverlayInfo={overlayInfo} />,
    );

    const firstCurrentConfig = (useGSAP as jest.Mock).mock.calls[0][1];

    rerender(
      <DisplayParticipantOverlay width={25} participantOverlayInfo={overlayInfo} />,
    );

    const secondCurrentConfig = (useGSAP as jest.Mock).mock.calls[2][1];

    expect(firstCurrentConfig.dependencies).toEqual([overlayInfo]);
    expect(secondCurrentConfig.dependencies).toEqual([overlayInfo]);
  });
});
