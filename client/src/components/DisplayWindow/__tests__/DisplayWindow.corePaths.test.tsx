import { render, screen } from "@testing-library/react";
import DisplayWindow from "../DisplayWindow";
import type { Box } from "../../../types";

const mockUseSelector = jest.fn();
const mockUseCachedVideoUrl = jest.fn((url?: string) => url);

jest.mock("../../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) => mockUseSelector(selector),
}));

jest.mock("../../../hooks/useCachedMediaUrl", () => ({
  useCachedVideoUrl: (url?: string) => mockUseCachedVideoUrl(url),
}));

jest.mock("../DisplayBox", () => ({
  __esModule: true,
  default: ({ isPrev }: { isPrev?: boolean }) => (
    <div data-testid={isPrev ? "display-box-prev" : "display-box"} />
  ),
}));
jest.mock("../DisplayStreamText", () => ({
  __esModule: true,
  default: ({ isPrev }: { isPrev?: boolean }) => (
    <div data-testid={isPrev ? "display-stream-text-prev" : "display-stream-text"} />
  ),
}));
jest.mock("../DisplayEditor", () => ({
  __esModule: true,
  default: () => <div data-testid="display-editor-mock" />,
}));
jest.mock("../DisplayStreamBible", () => ({
  __esModule: true,
  default: () => <div data-testid="display-stream-bible-mock" />,
}));
jest.mock("../DisplayParticipantOverlay", () => ({
  __esModule: true,
  default: () => <div data-testid="display-participant-overlay-mock" />,
}));
jest.mock("../DisplayStbOverlay", () => ({
  __esModule: true,
  default: () => <div data-testid="display-stb-overlay-mock" />,
}));
jest.mock("../DisplayQrCodeOverlay", () => ({
  __esModule: true,
  default: () => <div data-testid="display-qr-overlay-mock" />,
}));
jest.mock("../DisplayImageOverlay", () => ({
  __esModule: true,
  default: () => <div data-testid="display-image-overlay-mock" />,
}));
jest.mock("../DisplayStreamFormattedText", () => ({
  __esModule: true,
  default: () => <div data-testid="display-formatted-text-mock" />,
}));
jest.mock("../HLSVideoPlayer", () => ({
  __esModule: true,
  default: ({ src, originalSrc }: { src: string; originalSrc: string }) => (
    <div data-testid="window-hls-player" data-src={src} data-original-src={originalSrc} />
  ),
}));
jest.mock("../MonitorView", () => ({
  __esModule: true,
  default: ({ showNextSlide, effectiveShowClock, effectiveShowTimer }: any) => (
    <div
      data-testid="monitor-view-mock"
      data-show-next-slide={showNextSlide ? "true" : "false"}
      data-show-clock={effectiveShowClock ? "true" : "false"}
      data-show-timer={effectiveShowTimer ? "true" : "false"}
    />
  ),
}));

const baseState = {
  undoable: {
    present: {
      preferences: {
        monitorSettings: {
          showClock: true,
          showTimer: true,
          showNextSlide: true,
          clockFontSize: 16,
          timerFontSize: 18,
        },
      },
    },
  },
};

const baseBox: Box = {
  id: "b1",
  words: "Hello",
  width: 50,
  height: 50,
  fontSize: 40,
  brightness: 100,
  topMargin: 0,
  sideMargin: 0,
  x: 0,
  y: 0,
  background: "",
  fontColor: "#fff",
  shouldKeepAspectRatio: false,
  transparent: false,
  excludeFromOverflow: false,
  align: "center",
  slideIndex: 0,
  label: "Main",
  isBold: false,
  isItalic: false,
};

describe("DisplayWindow core paths", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSelector.mockImplementation((selector) => selector(baseState));
  });

  it("renders monitor mode through MonitorView with next-slide and clock/timer flags", () => {
    render(
      <DisplayWindow
        displayType="monitor"
        boxes={[baseBox]}
        nextBoxes={[{ ...baseBox, id: "next-1" }]}
        showMonitorClockTimer
      />,
    );

    const monitor = screen.getByTestId("monitor-view-mock");
    expect(monitor).toBeInTheDocument();
    expect(monitor).toHaveAttribute("data-show-next-slide", "true");
    expect(monitor).toHaveAttribute("data-show-clock", "true");
    expect(monitor).toHaveAttribute("data-show-timer", "true");
  });

  it("renders stream mode with stream text plus stream overlays", () => {
    render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        prevBoxes={[{ ...baseBox, id: "prev-1" }]}
        participantOverlayInfo={{ id: "p1", type: "participant", name: "Alice" }}
        stbOverlayInfo={{ id: "s1", type: "stick-to-bottom", heading: "Welcome" }}
        qrCodeOverlayInfo={{ id: "q1", type: "qr-code", url: "https://example.com" }}
        imageOverlayInfo={{ id: "i1", type: "image", imageUrl: "https://img.jpg" }}
        formattedTextDisplayInfo={{ text: "formatted" }}
      />,
    );

    expect(screen.getByTestId("display-stream-text")).toBeInTheDocument();
    expect(screen.getByTestId("display-stream-text-prev")).toBeInTheDocument();
    expect(screen.getByTestId("display-stream-bible-mock")).toBeInTheDocument();
    expect(screen.getByTestId("display-stb-overlay-mock")).toBeInTheDocument();
    expect(screen.getByTestId("display-participant-overlay-mock")).toBeInTheDocument();
    expect(screen.getByTestId("display-qr-overlay-mock")).toBeInTheDocument();
    expect(screen.getByTestId("display-image-overlay-mock")).toBeInTheDocument();
    expect(screen.getByTestId("display-formatted-text-mock")).toBeInTheDocument();
  });

  it("renders editor mode with DisplayEditor boxes", () => {
    render(<DisplayWindow displayType="editor" boxes={[baseBox, { ...baseBox, id: "b2" }]} />);
    expect(screen.getAllByTestId("display-editor-mock")).toHaveLength(2);
  });

  it("renders display boxes and mounts background HLS player when video background is active", async () => {
    const videoBox: Box = {
      ...baseBox,
      id: "video-box",
      mediaInfo: {
        id: "m1",
        type: "video",
        background: "https://cdn.example.com/stream.m3u8",
      } as any,
    };

    render(
      <DisplayWindow
        displayType="projector"
        boxes={[videoBox]}
        prevBoxes={[{ ...baseBox, id: "prev" }]}
        shouldPlayVideo
      />,
    );

    expect(screen.getByTestId("display-box")).toBeInTheDocument();
    expect(screen.getByTestId("display-box-prev")).toBeInTheDocument();

    expect(await screen.findByTestId("window-hls-player")).toBeInTheDocument();
  });
});
