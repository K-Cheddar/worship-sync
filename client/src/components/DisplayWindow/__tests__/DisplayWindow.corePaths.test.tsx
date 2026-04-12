import { act, render, screen } from "@testing-library/react";
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
  default: ({
    participantOverlayInfo,
    prevParticipantOverlayInfo,
  }: {
    participantOverlayInfo?: { name?: string };
    prevParticipantOverlayInfo?: { name?: string };
  }) => (
    <div
      data-testid="display-participant-overlay-mock"
      data-current-name={participantOverlayInfo?.name || ""}
      data-prev-name={prevParticipantOverlayInfo?.name || ""}
    />
  ),
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
          timerId: null,
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

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders monitor mode through MonitorView with next-slide and clock/timer flags", () => {
    render(
      <DisplayWindow
        displayType="monitor"
        boxes={[baseBox]}
        nextBoxes={[{ ...baseBox, id: "next-1" }]}
        showMonitorClockTimer
        monitorLayoutMode="full-monitor"
      />,
    );

    const monitor = screen.getByTestId("monitor-view-mock");
    expect(monitor).toBeInTheDocument();
    expect(monitor).toHaveAttribute("data-show-next-slide", "true");
    expect(monitor).toHaveAttribute("data-show-clock", "true");
    expect(monitor).toHaveAttribute("data-show-timer", "true");
  });

  it("renders monitor previews as content-only by default", () => {
    render(
      <DisplayWindow
        displayType="monitor"
        boxes={[baseBox]}
        prevBoxes={[{ ...baseBox, id: "prev-monitor" }]}
      />,
    );

    expect(screen.queryByTestId("monitor-view-mock")).not.toBeInTheDocument();
    expect(screen.getByTestId("display-box")).toBeInTheDocument();
    expect(screen.getByTestId("display-box-prev")).toBeInTheDocument();
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

  it("unmounts the previous display layer after the display transition window", () => {
    jest.useFakeTimers();

    const { rerender } = render(
      <DisplayWindow displayType="projector" boxes={[baseBox]} prevBoxes={[]} />,
    );

    expect(screen.queryByTestId("display-box-prev")).not.toBeInTheDocument();

    rerender(
      <DisplayWindow
        displayType="projector"
        boxes={[{ ...baseBox, id: "next-box" }]}
        prevBoxes={[baseBox]}
      />,
    );

    expect(screen.getByTestId("display-box-prev")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(499);
    });

    expect(screen.getByTestId("display-box-prev")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(screen.queryByTestId("display-box-prev")).not.toBeInTheDocument();
  });

  it("unmounts the previous stream text layer after the stream transition window", () => {
    jest.useFakeTimers();

    const { rerender } = render(
      <DisplayWindow displayType="stream" boxes={[baseBox]} prevBoxes={[]} />,
    );

    expect(screen.queryByTestId("display-stream-text-prev")).not.toBeInTheDocument();

    rerender(
      <DisplayWindow
        displayType="stream"
        boxes={[{ ...baseBox, id: "next-stream-box" }]}
        prevBoxes={[baseBox]}
      />,
    );

    expect(screen.getByTestId("display-stream-text-prev")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(349);
    });

    expect(screen.getByTestId("display-stream-text-prev")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(screen.queryByTestId("display-stream-text-prev")).not.toBeInTheDocument();
  });

  it("keeps the stream item layer hidden until a participant overlay has fully animated off screen", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-19T12:00:00.000Z"));

    render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        participantOverlayInfo={{
          id: "p1",
          type: "participant",
          name: "Alice",
          time: Date.now(),
          duration: 0,
        }}
      />,
    );

    const streamItemLayer = screen.getByTestId("stream-item-layer");
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(streamItemLayer).toHaveStyle({ opacity: "1" });
  });

  it("does not remount an expired stream overlay when the preview opens later", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-19T12:00:00.000Z"));

    render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        imageOverlayInfo={{
          id: "img-expired",
          type: "image",
          imageUrl: "https://img.example/expired.jpg",
          time: Date.now() - 6000,
          duration: 0,
        }}
      />,
    );

    expect(screen.queryByTestId("display-image-overlay-mock")).not.toBeInTheDocument();
    expect(screen.getByTestId("stream-item-layer")).toHaveStyle({ opacity: "1" });
  });

  it("keeps the stream item layer hidden while a cleared overlay is still exiting through prev overlay state", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-19T12:00:00.000Z"));

    render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        participantOverlayInfo={{
          id: "p1-cleared",
          type: "participant",
          time: Date.now(),
        }}
        prevParticipantOverlayInfo={{
          id: "p1-prev",
          type: "participant",
          name: "Alice",
          time: Date.now() - 1000,
        }}
      />,
    );

    const streamItemLayer = screen.getByTestId("stream-item-layer");
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(1400);
    });

    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(streamItemLayer).toHaveStyle({ opacity: "1" });
  });

  it("does not keep the stream item layer hidden when clearing an overlay that had already expired", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-19T12:00:00.000Z"));

    render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        participantOverlayInfo={{
          id: "p1-cleared",
          type: "participant",
          time: Date.now(),
        }}
        prevParticipantOverlayInfo={{
          id: "p1-prev-expired",
          type: "participant",
          name: "Alice",
          time: Date.now() - 7000,
          duration: 0,
        }}
      />,
    );

    expect(screen.getByTestId("stream-item-layer")).toHaveStyle({ opacity: "1" });
  });

  it("keeps the previous participant overlay mounted during a same-type replacement so it can exit", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-03-19T12:00:00.000Z"));

    render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        participantOverlayInfo={{
          id: "p2-current",
          type: "participant",
          name: "Bob",
          time: Date.now(),
          duration: 0,
        }}
        prevParticipantOverlayInfo={{
          id: "p1-prev",
          type: "participant",
          name: "Alice",
          time: Date.now() - 1000,
          duration: 0,
        }}
      />,
    );

    const overlay = screen.getByTestId("display-participant-overlay-mock");
    expect(overlay).toHaveAttribute("data-current-name", "Bob");
    expect(overlay).toHaveAttribute("data-prev-name", "Alice");
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
