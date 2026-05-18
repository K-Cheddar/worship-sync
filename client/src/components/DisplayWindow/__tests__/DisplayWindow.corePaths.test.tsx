import { act, render, screen } from "@testing-library/react";
import DisplayWindow from "../DisplayWindow";
import type { Box } from "../../../types";
import { setServerTimeOffset } from "../../../utils/serverTime";

const mockUseSelector = jest.fn();
const mockUseCachedVideoUrl = jest.fn((url?: string) => url);
type KeepAliveMode = "max" | "replace";
type KeepAliveStart = (
  overlayKey: string | null,
  localVisibleMs: number | null,
  mode?: KeepAliveMode,
) => void;
type ParticipantOverlayMockProps = {
  participantOverlayInfo?: { name?: string };
  prevParticipantOverlayInfo?: { name?: string };
  currentKeepAliveKey?: string | null;
  currentKeepAliveMs?: number | null;
  prevKeepAliveKey?: string | null;
  prevKeepAliveMs?: number | null;
  onLocalKeepAliveStart?: KeepAliveStart;
};
type StbOverlayMockProps = {
  currentKeepAliveKey?: string | null;
  currentKeepAliveMs?: number | null;
  onLocalKeepAliveStart?: KeepAliveStart;
  prevKeepAliveKey?: string | null;
  prevKeepAliveMs?: number | null;
  prevStbOverlayInfo?: { heading?: string; subHeading?: string };
  stbOverlayInfo?: { heading?: string; subHeading?: string };
};
type QrCodeOverlayMockProps = {
  currentKeepAliveKey?: string | null;
  currentKeepAliveMs?: number | null;
  onLocalKeepAliveStart?: KeepAliveStart;
  prevKeepAliveKey?: string | null;
  prevKeepAliveMs?: number | null;
  prevQrCodeOverlayInfo?: { url?: string; description?: string };
  qrCodeOverlayInfo?: { url?: string; description?: string };
};
type ImageOverlayMockProps = {
  currentKeepAliveKey?: string | null;
  currentKeepAliveMs?: number | null;
  imageOverlayInfo?: { imageUrl?: string };
  onLocalKeepAliveStart?: KeepAliveStart;
  prevImageOverlayInfo?: { imageUrl?: string };
  prevKeepAliveKey?: string | null;
  prevKeepAliveMs?: number | null;
};
type MonitorViewMockProps = {
  showNextSlide?: boolean;
  effectiveShowClock?: boolean;
  effectiveShowTimer?: boolean;
};

jest.mock("../../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) => mockUseSelector(selector),
}));

jest.mock("../../../hooks/useCachedMediaUrl", () => ({
  useCachedVideoUrl: (url?: string) => mockUseCachedVideoUrl(url),
}));

jest.mock("../DisplayBox", () => ({
  __esModule: true,
  default: ({ box, isPrev }: { box: Box; isPrev?: boolean }) => (
    <div
      data-testid={isPrev ? "display-box-prev" : "display-box"}
      data-box-id={box.id}
      data-words={box.words || ""}
    />
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
  default: (() => {
    const React = require("react") as typeof import("react");

    const MockDisplayParticipantOverlay = ({
      participantOverlayInfo,
      prevParticipantOverlayInfo,
      currentKeepAliveKey,
      currentKeepAliveMs,
      prevKeepAliveKey,
      prevKeepAliveMs,
      onLocalKeepAliveStart,
    }: ParticipantOverlayMockProps) => {
      React.useEffect(() => {
        if (participantOverlayInfo?.name) {
          onLocalKeepAliveStart?.(
            currentKeepAliveKey ?? null,
            currentKeepAliveMs ?? null,
            "max",
          );
        }

        if (prevParticipantOverlayInfo?.name) {
          onLocalKeepAliveStart?.(
            prevKeepAliveKey ?? null,
            prevKeepAliveMs ?? null,
            "replace",
          );
        }
      }, [
        currentKeepAliveKey,
        currentKeepAliveMs,
        onLocalKeepAliveStart,
        participantOverlayInfo?.name,
        prevKeepAliveKey,
        prevKeepAliveMs,
        prevParticipantOverlayInfo?.name,
      ]);

      return (
        <div
          data-testid="display-participant-overlay-mock"
          data-current-name={participantOverlayInfo?.name || ""}
          data-prev-name={prevParticipantOverlayInfo?.name || ""}
        />
      );
    };

    return MockDisplayParticipantOverlay;
  })(),
}));
jest.mock("../DisplayStbOverlay", () => ({
  __esModule: true,
  default: (() => {
    const React = require("react") as typeof import("react");

    const MockDisplayStbOverlay = ({
      currentKeepAliveKey,
      currentKeepAliveMs,
      onLocalKeepAliveStart,
      prevKeepAliveKey,
      prevKeepAliveMs,
      prevStbOverlayInfo,
      stbOverlayInfo,
    }: StbOverlayMockProps) => {
      React.useEffect(() => {
        if (stbOverlayInfo?.heading || stbOverlayInfo?.subHeading) {
          onLocalKeepAliveStart?.(
            currentKeepAliveKey ?? null,
            currentKeepAliveMs ?? null,
            "max",
          );
        }
        if (prevStbOverlayInfo?.heading || prevStbOverlayInfo?.subHeading) {
          onLocalKeepAliveStart?.(
            prevKeepAliveKey ?? null,
            prevKeepAliveMs ?? null,
            "replace",
          );
        }
      }, [
        currentKeepAliveKey,
        currentKeepAliveMs,
        onLocalKeepAliveStart,
        prevKeepAliveKey,
        prevKeepAliveMs,
        prevStbOverlayInfo?.heading,
        prevStbOverlayInfo?.subHeading,
        stbOverlayInfo?.heading,
        stbOverlayInfo?.subHeading,
      ]);

      return <div data-testid="display-stb-overlay-mock" />;
    };

    return MockDisplayStbOverlay;
  })(),
}));
jest.mock("../DisplayQrCodeOverlay", () => ({
  __esModule: true,
  default: (() => {
    const React = require("react") as typeof import("react");

    const MockDisplayQrCodeOverlay = ({
      currentKeepAliveKey,
      currentKeepAliveMs,
      onLocalKeepAliveStart,
      prevKeepAliveKey,
      prevKeepAliveMs,
      prevQrCodeOverlayInfo,
      qrCodeOverlayInfo,
    }: QrCodeOverlayMockProps) => {
      React.useEffect(() => {
        if (qrCodeOverlayInfo?.url || qrCodeOverlayInfo?.description) {
          onLocalKeepAliveStart?.(
            currentKeepAliveKey ?? null,
            currentKeepAliveMs ?? null,
            "max",
          );
        }
        if (prevQrCodeOverlayInfo?.url || prevQrCodeOverlayInfo?.description) {
          onLocalKeepAliveStart?.(
            prevKeepAliveKey ?? null,
            prevKeepAliveMs ?? null,
            "replace",
          );
        }
      }, [
        currentKeepAliveKey,
        currentKeepAliveMs,
        onLocalKeepAliveStart,
        prevKeepAliveKey,
        prevKeepAliveMs,
        prevQrCodeOverlayInfo?.description,
        prevQrCodeOverlayInfo?.url,
        qrCodeOverlayInfo?.description,
        qrCodeOverlayInfo?.url,
      ]);

      return <div data-testid="display-qr-overlay-mock" />;
    };

    return MockDisplayQrCodeOverlay;
  })(),
}));
jest.mock("../DisplayImageOverlay", () => ({
  __esModule: true,
  default: (() => {
    const React = require("react") as typeof import("react");

    const MockDisplayImageOverlay = ({
      currentKeepAliveKey,
      currentKeepAliveMs,
      imageOverlayInfo,
      onLocalKeepAliveStart,
      prevImageOverlayInfo,
      prevKeepAliveKey,
      prevKeepAliveMs,
    }: ImageOverlayMockProps) => {
      React.useEffect(() => {
        if (imageOverlayInfo?.imageUrl) {
          onLocalKeepAliveStart?.(
            currentKeepAliveKey ?? null,
            currentKeepAliveMs ?? null,
            "max",
          );
        }
        if (prevImageOverlayInfo?.imageUrl) {
          onLocalKeepAliveStart?.(
            prevKeepAliveKey ?? null,
            prevKeepAliveMs ?? null,
            "replace",
          );
        }
      }, [
        currentKeepAliveKey,
        currentKeepAliveMs,
        imageOverlayInfo?.imageUrl,
        onLocalKeepAliveStart,
        prevImageOverlayInfo?.imageUrl,
        prevKeepAliveKey,
        prevKeepAliveMs,
      ]);

      return <div data-testid="display-image-overlay-mock" />;
    };

    return MockDisplayImageOverlay;
  })(),
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
  default: ({
    showNextSlide,
    effectiveShowClock,
    effectiveShowTimer,
  }: MonitorViewMockProps) => (
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
    setServerTimeOffset(0);
    mockUseSelector.mockImplementation((selector) => selector(baseState));
  });

  afterEach(() => {
    setServerTimeOffset(0);
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

  it("wraps width=100 projector/monitor output in a centered black viewport stage (letterbox/pillarbox)", () => {
    render(
      <DisplayWindow
        displayType="projector"
        boxes={[baseBox]}
        prevBoxes={[]}
        width={100}
      />,
    );

    const stage = screen.getByTestId("display-full-viewport-stage");
    expect(stage).toHaveClass("items-center", "justify-center");
  });

  it("does not use the fullscreen viewport stage for stream when width is 100", () => {
    render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        prevBoxes={[]}
        width={100}
      />,
    );

    expect(screen.queryByTestId("display-full-viewport-stage")).not.toBeInTheDocument();
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

  it("renders the previous display layer when reused box ids have changed visual content", () => {
    render(
      <DisplayWindow
        displayType="projector"
        boxes={[{ ...baseBox, id: "same-box", words: "Current lyrics" }]}
        prevBoxes={[{ ...baseBox, id: "same-box", words: "Previous lyrics" }]}
      />,
    );

    expect(screen.getByTestId("display-box-prev")).toBeInTheDocument();
  });

  it("remounts the current display box when reused box ids receive changed visual content", () => {
    const { rerender } = render(
      <DisplayWindow
        displayType="projector"
        boxes={[{ ...baseBox, id: "same-box", words: "Before" }]}
        prevBoxes={[]}
      />,
    );

    const firstCurrentBox = screen.getByTestId("display-box");

    rerender(
      <DisplayWindow
        displayType="projector"
        boxes={[{ ...baseBox, id: "same-box", words: "After" }]}
        prevBoxes={[{ ...baseBox, id: "same-box", words: "Before" }]}
      />,
    );

    expect(screen.getByTestId("display-box")).not.toBe(firstCurrentBox);
    expect(screen.getByTestId("display-box")).toHaveAttribute("data-words", "After");
    expect(screen.getByTestId("display-box-prev")).toHaveAttribute("data-words", "Before");
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

  it("keeps a participant overlay mounted long enough to finish the local exit when the device starts late", () => {
    jest.useFakeTimers();
    const t0 = new Date("2026-03-19T12:00:00.000Z").getTime();
    jest.setSystemTime(t0 + 250);

    render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        participantOverlayInfo={{
          id: "p-late-start",
          type: "participant",
          name: "Alice",
          time: t0,
          duration: 0,
        }}
      />,
    );

    const streamItemLayer = screen.getByTestId("stream-item-layer");
    expect(screen.getByTestId("display-participant-overlay-mock")).toBeInTheDocument();
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(5_000);
    });

    expect(screen.getByTestId("display-participant-overlay-mock")).toBeInTheDocument();
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(249);
    });

    expect(screen.getByTestId("display-participant-overlay-mock")).toBeInTheDocument();
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(21);
    });

    expect(screen.queryByTestId("display-participant-overlay-mock")).not.toBeInTheDocument();
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

  it("uses the shared Firebase-offset clock when deciding whether a stream overlay has already expired", () => {
    jest.useFakeTimers();
    const t0 = new Date("2026-03-19T12:00:00.000Z").getTime();
    jest.setSystemTime(t0);
    setServerTimeOffset(30_000);

    render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        participantOverlayInfo={{
          id: "p-server-expired",
          type: "participant",
          name: "Alice",
          time: t0 + 24_000,
          duration: 0,
        }}
      />,
    );

    expect(screen.queryByTestId("display-participant-overlay-mock")).not.toBeInTheDocument();
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

  it("keeps a previous participant exit mounted long enough to finish when the clear reaches the device late", () => {
    jest.useFakeTimers();
    const t0 = new Date("2026-03-19T12:00:00.000Z").getTime();
    jest.setSystemTime(t0 + 250);

    render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        participantOverlayInfo={{
          id: "p1-cleared-late",
          type: "participant",
          time: t0,
        }}
        prevParticipantOverlayInfo={{
          id: "p1-prev-late",
          type: "participant",
          name: "Alice",
          time: t0 - 1000,
        }}
      />,
    );

    const streamItemLayer = screen.getByTestId("stream-item-layer");
    expect(screen.getByTestId("display-participant-overlay-mock")).toHaveAttribute(
      "data-prev-name",
      "Alice",
    );
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(1_250);
    });

    expect(screen.getByTestId("display-participant-overlay-mock")).toHaveAttribute(
      "data-prev-name",
      "Alice",
    );
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(249);
    });

    expect(screen.getByTestId("display-participant-overlay-mock")).toHaveAttribute(
      "data-prev-name",
      "Alice",
    );
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(21);
    });

    expect(screen.queryByTestId("display-participant-overlay-mock")).not.toBeInTheDocument();
    expect(streamItemLayer).toHaveStyle({ opacity: "1" });
  });

  it("restores stream item content shortly after an early clear instead of waiting for the original overlay duration", () => {
    jest.useFakeTimers();
    const t0 = new Date("2026-03-19T12:00:00.000Z").getTime();
    jest.setSystemTime(t0);

    const { rerender } = render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        participantOverlayInfo={{
          id: "p-long",
          type: "participant",
          name: "Alice",
          time: t0,
          duration: 10,
        }}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(250);
    });

    rerender(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        participantOverlayInfo={{
          id: "p-cleared-early",
          type: "participant",
          time: t0 + 250,
        }}
        prevParticipantOverlayInfo={{
          id: "p-long",
          type: "participant",
          name: "Alice",
          time: t0,
          duration: 10,
        }}
      />,
    );

    const streamItemLayer = screen.getByTestId("stream-item-layer");
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(1_499);
    });

    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(21);
    });

    expect(screen.queryByTestId("display-participant-overlay-mock")).not.toBeInTheDocument();
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

  it("does not remount an already-expired previous participant overlay when a new image overlay rerenders before the scheduled clock update fires", () => {
    jest.useFakeTimers();
    const t0 = new Date("2026-03-19T12:00:00.000Z").getTime();
    jest.setSystemTime(t0);

    const { rerender } = render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        participantOverlayInfo={{
          id: "p-live",
          type: "participant",
          name: "Alice",
          time: t0,
          duration: 0,
        }}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(5_999);
    });

    rerender(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        participantOverlayInfo={{
          id: "p-cleared",
          type: "participant",
          time: t0 + 6_000,
        }}
        prevParticipantOverlayInfo={{
          id: "p-live",
          type: "participant",
          name: "Alice",
          time: t0,
          duration: 0,
        }}
        imageOverlayInfo={{
          id: "img-live",
          type: "image",
          imageUrl: "https://img.example/live.jpg",
          time: t0 + 6_000,
        }}
      />,
    );

    expect(screen.queryByTestId("display-participant-overlay-mock")).not.toBeInTheDocument();
    expect(screen.getByTestId("display-image-overlay-mock")).toBeInTheDocument();
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

  it("exposes previous participant for exit when image is live and participant slot is empty with a newer placeholder time", () => {
    jest.useFakeTimers();
    const t0 = new Date("2026-03-19T12:00:00.000Z").getTime();
    jest.setSystemTime(t0);

    render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        participantOverlayInfo={{
          id: "p-empty",
          type: "participant",
          time: t0 + 50_000,
        }}
        prevParticipantOverlayInfo={{
          id: "p-prev",
          type: "participant",
          name: "Alex",
          time: t0 - 2000,
          duration: 0,
        }}
        imageOverlayInfo={{
          id: "img-1",
          type: "image",
          imageUrl: "https://img.example/crossfade.jpg",
          time: t0,
        }}
      />,
    );

    const overlay = screen.getByTestId("display-participant-overlay-mock");
    expect(overlay.getAttribute("data-prev-name")).toBe("Alex");
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
      } as NonNullable<Box["mediaInfo"]>,
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
