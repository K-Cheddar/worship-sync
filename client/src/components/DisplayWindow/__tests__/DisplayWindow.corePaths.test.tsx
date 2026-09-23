import { act, render, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import DisplayWindow from "../DisplayWindow";
import type { Box, MediaType } from "../../../types";
import { setServerTimeOffset } from "../../../utils/serverTime";

const mockUseSelector = jest.fn();
const mockUseCachedVideoUrl = jest.fn((url?: string) => url);
const mockPublishMediaPreparationManifest = jest.fn();
const mockRemoteMediaPreparationManifest = jest.fn(() => ({
  manifest: undefined,
  cacheMap: {},
}));
let mockLocalVideoViewInstanceCounter = 0;
let mockDisplayTransitionComplete: (() => void) | undefined;
const mockDisplayTransitionTimeline = {
  addLabel: jest.fn(),
  fromTo: jest.fn(),
  kill: jest.fn(),
};
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
type BoardPostOverlayMockProps = {
  boardPostStreamInfo?: { text?: string; author?: string };
  currentKeepAliveKey?: string | null;
  currentKeepAliveMs?: number | null;
  onLocalKeepAliveStart?: KeepAliveStart;
  prevBoardPostStreamInfo?: { text?: string; author?: string };
  prevKeepAliveKey?: string | null;
  prevKeepAliveMs?: number | null;
};
type MonitorViewMockProps = {
  showNextSlide?: boolean;
  effectiveShowClock?: boolean;
  effectiveShowTimer?: boolean;
  currentMediaLayer?: ReactNode;
};

jest.mock("gsap", () => ({
  __esModule: true,
  default: {
    set: jest.fn(),
    timeline: jest.fn((options?: { onComplete?: () => void }) => {
      mockDisplayTransitionComplete = options?.onComplete;
      return mockDisplayTransitionTimeline;
    }),
  },
}));

jest.mock("../../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    mockUseSelector(selector),
}));

jest.mock("../../../hooks/useCachedMediaUrl", () => ({
  useCachedVideoUrl: (url?: string) => mockUseCachedVideoUrl(url),
}));

jest.mock("../../../hooks/useMediaPreparationManifest", () => ({
  usePublishMediaPreparationManifest: (
    ...args: Parameters<typeof mockPublishMediaPreparationManifest>
  ) =>
    mockPublishMediaPreparationManifest(...args),
  useRemoteMediaPreparationManifest: (
    ...args: Parameters<typeof mockRemoteMediaPreparationManifest>
  ) =>
    mockRemoteMediaPreparationManifest(...args),
}));

jest.mock("../DisplayBox", () => ({
  __esModule: true,
  default: function MockDisplayBox({
    box,
    prevBox,
    isPrev,
    isWindowVideoLoaded,
    onPaintReadyChange,
  }: {
    box: Box;
    prevBox?: Box;
    isPrev?: boolean;
    isWindowVideoLoaded?: boolean;
    onPaintReadyChange?: (ready: boolean) => void;
  }) {
    useEffect(() => {
      onPaintReadyChange?.(true);
    }, [onPaintReadyChange]);
    return (
      <div
        data-testid={isPrev ? "display-box-prev" : "display-box"}
        data-box-id={box.id}
        data-words={box.words || ""}
        data-prev-words={prevBox?.words ?? ""}
        data-has-prev-box={prevBox ? "true" : "false"}
        data-video-loaded={isWindowVideoLoaded ? "true" : "false"}
      />
    );
  },
}));
jest.mock("../DisplayStreamText", () => ({
  __esModule: true,
  default: ({ isPrev }: { isPrev?: boolean }) => (
    <div
      data-testid={isPrev ? "display-stream-text-prev" : "display-stream-text"}
    />
  ),
}));
jest.mock("../DisplayEditor", () => ({
  __esModule: true,
  default: () => <div data-testid="display-editor-mock" />,
}));
jest.mock("../LocalVideoInputView", () => ({
  __esModule: true,
  default: function MockLocalVideoInputView({
    input,
    playAudio,
    captureEnabled,
    receiveHighQuality,
    showErrors,
    transparentBackground,
    volume,
    onPaintReadyChange,
  }: {
    input: { deviceLabel: string };
    playAudio?: boolean;
    captureEnabled?: boolean;
    receiveHighQuality?: boolean;
    showErrors?: boolean;
    transparentBackground?: boolean;
    volume?: number;
    onPaintReadyChange?: (ready: boolean) => void;
  }) {
    const { useEffect, useRef } =
      jest.requireActual<typeof import("react")>("react");
    const instanceId = useRef<number | undefined>(undefined);
    instanceId.current ??= ++mockLocalVideoViewInstanceCounter;
    useEffect(() => {
      onPaintReadyChange?.(true);
    }, [onPaintReadyChange]);
    return (
      <div
        data-testid="local-video-input-view"
        data-instance-id={instanceId.current}
        data-play-audio={playAudio ? "true" : "false"}
        data-capture-enabled={captureEnabled ? "true" : "false"}
        data-high-quality={receiveHighQuality ? "true" : "false"}
        data-show-errors={showErrors ? "true" : "false"}
        data-transparent-background={transparentBackground ? "true" : "false"}
        data-volume={String(volume ?? "")}
      >
        {input.deviceLabel}
      </div>
    );
  },
}));
jest.mock("../DisplayStreamBible", () => ({
  __esModule: true,
  default: ({
    bibleDisplayInfo,
    prevBibleDisplayInfo,
  }: {
    bibleDisplayInfo?: { title?: string };
    prevBibleDisplayInfo?: { title?: string };
  }) => (
    <div
      data-testid="display-stream-bible-mock"
      data-current-title={bibleDisplayInfo?.title || ""}
      data-prev-title={prevBibleDisplayInfo?.title || ""}
    />
  ),
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
jest.mock("../DisplayBoardPostOverlay", () => ({
  __esModule: true,
  default: (() => {
    const React = require("react") as typeof import("react");

    const MockDisplayBoardPostOverlay = ({
      boardPostStreamInfo,
      currentKeepAliveKey,
      currentKeepAliveMs,
      onLocalKeepAliveStart,
      prevBoardPostStreamInfo,
      prevKeepAliveKey,
      prevKeepAliveMs,
    }: BoardPostOverlayMockProps) => {
      React.useEffect(() => {
        if (boardPostStreamInfo?.text?.trim()) {
          onLocalKeepAliveStart?.(
            currentKeepAliveKey ?? null,
            currentKeepAliveMs ?? null,
            "max",
          );
        }
        if (prevBoardPostStreamInfo?.text?.trim()) {
          onLocalKeepAliveStart?.(
            prevKeepAliveKey ?? null,
            prevKeepAliveMs ?? null,
            "replace",
          );
        }
      }, [
        boardPostStreamInfo?.text,
        currentKeepAliveKey,
        currentKeepAliveMs,
        onLocalKeepAliveStart,
        prevBoardPostStreamInfo?.text,
        prevKeepAliveKey,
        prevKeepAliveMs,
      ]);

      return (
        <div
          data-testid="display-board-post-overlay-mock"
          data-current-text={boardPostStreamInfo?.text || ""}
          data-prev-text={prevBoardPostStreamInfo?.text || ""}
        />
      );
    };

    return MockDisplayBoardPostOverlay;
  })(),
}));
jest.mock("../DisplayStreamFormattedText", () => ({
  __esModule: true,
  default: ({
    formattedTextDisplayInfo,
    prevFormattedTextDisplayInfo,
  }: {
    formattedTextDisplayInfo?: { text?: string };
    prevFormattedTextDisplayInfo?: { text?: string };
  }) => (
    <div
      data-testid="display-formatted-text-mock"
      data-current-text={formattedTextDisplayInfo?.text || ""}
      data-prev-text={prevFormattedTextDisplayInfo?.text || ""}
    />
  ),
}));
jest.mock("../HLSVideoPlayer", () => ({
  __esModule: true,
  default: ({
    src,
    originalSrc,
    onLoadedData,
    muted,
    playbackRole,
  }: {
    src: string;
    originalSrc: string;
    onLoadedData?: () => void;
    muted?: boolean;
    playbackRole?: "preview" | "output";
  }) => (
    <button
      type="button"
      data-testid="window-hls-player"
      data-src={src}
      data-original-src={originalSrc}
      data-muted={muted ? "true" : "false"}
      data-playback-role={playbackRole}
      onClick={() => onLoadedData?.()}
    />
  ),
}));
jest.mock("../MonitorView", () => ({
  __esModule: true,
  default: ({
    showNextSlide,
    effectiveShowClock,
    effectiveShowTimer,
    currentMediaLayer,
  }: MonitorViewMockProps) => (
    <div
      data-testid="monitor-view-mock"
      data-show-next-slide={showNextSlide ? "true" : "false"}
      data-show-clock={effectiveShowClock ? "true" : "false"}
      data-show-timer={effectiveShowTimer ? "true" : "false"}
    >
      {currentMediaLayer}
    </div>
  ),
}));

const baseState = {
  // The projector clock/timer overlay mounts the real DisplayTimer, which reads
  // the timer list to resolve what it counts down.
  timers: { timers: [] },
  // Clock chrome waits for the registry; tests that expect it on must be loaded.
  displayOutputs: {
    list: [
      {
        id: "projector",
        type: "projector",
        name: "Projector",
        order: 0,
        enabled: true,
      },
      {
        id: "monitor",
        type: "monitor",
        name: "Monitor",
        order: 1,
        enabled: true,
      },
    ],
    isLoaded: true,
  },
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

const streamStateWithLocalVideoAudio = {
  ...baseState,
  displayOutputs: {
    list: [
      {
        id: "stream",
        type: "stream",
        name: "Stream",
        order: 0,
        enabled: true,
        settings: { localVideoAudioEnabled: true },
      },
    ],
    isLoaded: true,
  },
};

const localVideoInputFixture = {
  sourceId: "source-1",
  deviceLabel: "USB Capture",
  ownerDeviceId: "device-1",
  ownerLabel: "Booth",
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
    mockDisplayTransitionComplete = undefined;
    mockLocalVideoViewInstanceCounter = 0;
    setServerTimeOffset(0);
    mockUseCachedVideoUrl.mockImplementation((url?: string) => url);
    mockRemoteMediaPreparationManifest.mockReturnValue({
      manifest: undefined,
      cacheMap: {},
    });
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
        showClockTimer
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
    const { rerender } = render(
      <DisplayWindow
        displayType="monitor"
        boxes={[{ ...baseBox, id: "prev-monitor" }]}
      />,
    );

    expect(screen.queryByTestId("monitor-view-mock")).not.toBeInTheDocument();
    expect(screen.getByTestId("display-box")).toBeInTheDocument();
    expect(screen.queryByTestId("display-box-prev")).not.toBeInTheDocument();

    rerender(
      <DisplayWindow
        displayType="monitor"
        boxes={[baseBox]}
        prevBoxes={[{ ...baseBox, id: "prev-monitor" }]}
      />,
    );

    expect(screen.queryByTestId("display-box-prev")).not.toBeInTheDocument();
    expect(screen.getByTestId("display-box")).toHaveAttribute(
      "data-box-id",
      baseBox.id,
    );
  });

  it("fades in live content on first show without replaying stale prev", () => {
    render(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        boxes={[baseBox]}
        prevBoxes={[{ ...baseBox, id: "stale-prev", words: "Earlier slide" }]}
      />,
    );

    expect(screen.getByTestId("display-box")).toBeInTheDocument();
    expect(screen.queryByTestId("display-box-prev")).not.toBeInTheDocument();
  });

  it("keeps the prev layer available when the same slide is transmitted again", () => {
    const { rerender } = render(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        time={1000}
        boxes={[baseBox]}
        prevBoxes={[]}
      />,
    );

    rerender(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        time={2000}
        boxes={[{ ...baseBox, words: "Updated hello" }]}
        prevBoxes={[baseBox]}
      />,
    );

    // Different text with no real background still crossfades through a prev lane.
    expect(screen.getByTestId("display-box-prev")).toBeInTheDocument();

    act(() => mockDisplayTransitionComplete?.());

    expect(screen.queryByTestId("display-box-prev")).not.toBeInTheDocument();

    // A later transmit of identical visual content updates in place — no
    // duplicate lane and no fade of the background into itself.
    rerender(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        time={3000}
        boxes={[{ ...baseBox, words: "Updated hello" }]}
        prevBoxes={[{ ...baseBox, words: "Updated hello" }]}
      />,
    );

    expect(screen.queryByTestId("display-box-prev")).not.toBeInTheDocument();
    expect(screen.getByTestId("display-box")).toHaveAttribute(
      "data-words",
      "Updated hello",
    );
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "idle",
    );
  });

  it("recognizes local asset changes as visual transitions", () => {
    const localBox = (assetId: string): Box => ({
      ...baseBox,
      background: "local-image://asset",
      mediaInfo: {
        path: "",
        createdAt: "",
        updatedAt: "",
        format: "png",
        height: 1080,
        width: 1920,
        name: `${assetId}.png`,
        publicId: assetId,
        type: "image",
        id: assetId,
        background: "local-image://asset",
        thumbnail: "",
        source: "local",
        localImage: {
          id: assetId,
          ownerDeviceId: "device-1",
          ownerLabel: "Booth",
          fileName: `${assetId}.png`,
          contentType: "image/png",
          storagePolicy: "local-only",
        },
      } satisfies MediaType,
    });

    const { rerender } = render(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        time={1000}
        boxes={[localBox("asset-1")]}
      />,
    );
    const outgoingBox = screen.getByTestId("display-box");

    rerender(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        time={2000}
        boxes={[localBox("asset-2")]}
        prevBoxes={[localBox("asset-1")]}
      />,
    );

    expect(screen.getByTestId("display-box-prev")).toBe(outgoingBox);
  });

  describe("projector clock and timer", () => {
    it("renders the clock/timer overlay on a live projector", () => {
      render(
        <DisplayWindow
          displayType="projector"
          outputId="projector"
          boxes={[baseBox]}
          showClockTimer
        />,
      );

      expect(screen.getByTestId("projector-clock-timer")).toBeInTheDocument();
    });

    it("leaves the overlay off surfaces that do not render display chrome", () => {
      render(
        <DisplayWindow
          displayType="projector"
          outputId="projector"
          boxes={[baseBox]}
        />,
      );

      expect(
        screen.queryByTestId("projector-clock-timer"),
      ).not.toBeInTheDocument();
    });

    it("honors a projector that has both switched off", () => {
      mockUseSelector.mockImplementation((selector) =>
        selector({
          ...baseState,
          displayOutputs: {
            list: [
              {
                id: "projector",
                type: "projector",
                name: "Main",
                order: 0,
                enabled: true,
                settings: { showClock: false, showTimer: false },
              },
            ],
            isLoaded: true,
          },
        }),
      );

      render(
        <DisplayWindow
          displayType="projector"
          outputId="projector"
          boxes={[baseBox]}
          showClockTimer
        />,
      );

      expect(
        screen.queryByTestId("projector-clock-timer"),
      ).not.toBeInTheDocument();
    });

    it("does not flash the clock from shipped defaults before the registry loads", () => {
      mockUseSelector.mockImplementation((selector) =>
        selector({
          ...baseState,
          displayOutputs: {
            list: [
              {
                id: "projector",
                type: "projector",
                name: "Main",
                order: 0,
                enabled: true,
              },
            ],
            isLoaded: false,
          },
        }),
      );

      render(
        <DisplayWindow
          displayType="projector"
          outputId="projector"
          boxes={[baseBox]}
          showClockTimer
        />,
      );

      expect(
        screen.queryByTestId("projector-clock-timer"),
      ).not.toBeInTheDocument();
    });
  });

  it("renders stream mode with stream text plus stream overlays", () => {
    const { rerender } = render(
      <DisplayWindow
        displayType="stream"
        boxes={[{ ...baseBox, id: "prev-1" }]}
        participantOverlayInfo={{
          id: "p1",
          type: "participant",
          name: "Alice",
        }}
        stbOverlayInfo={{
          id: "s1",
          type: "stick-to-bottom",
          heading: "Welcome",
        }}
        qrCodeOverlayInfo={{
          id: "q1",
          type: "qr-code",
          url: "https://example.com",
        }}
        imageOverlayInfo={{
          id: "i1",
          type: "image",
          imageUrl: "https://img.jpg",
        }}
        formattedTextDisplayInfo={{ text: "formatted" }}
      />,
    );

    expect(screen.getByTestId("display-stream-text")).toBeInTheDocument();
    expect(
      screen.queryByTestId("display-stream-text-prev"),
    ).not.toBeInTheDocument();

    rerender(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        prevBoxes={[{ ...baseBox, id: "prev-1" }]}
        participantOverlayInfo={{
          id: "p1",
          type: "participant",
          name: "Alice",
        }}
        stbOverlayInfo={{
          id: "s1",
          type: "stick-to-bottom",
          heading: "Welcome",
        }}
        qrCodeOverlayInfo={{
          id: "q1",
          type: "qr-code",
          url: "https://example.com",
        }}
        imageOverlayInfo={{
          id: "i1",
          type: "image",
          imageUrl: "https://img.jpg",
        }}
        formattedTextDisplayInfo={{ text: "formatted" }}
      />,
    );

    expect(screen.getByTestId("display-stream-text")).toBeInTheDocument();
    expect(screen.getByTestId("display-stream-text-prev")).toBeInTheDocument();
    expect(screen.getByTestId("display-stream-bible-mock")).toBeInTheDocument();
    expect(screen.getByTestId("display-stb-overlay-mock")).toBeInTheDocument();
    expect(
      screen.getByTestId("display-participant-overlay-mock"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("display-qr-overlay-mock")).toBeInTheDocument();
    expect(
      screen.getByTestId("display-image-overlay-mock"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("display-formatted-text-mock"),
    ).toBeInTheDocument();
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

    expect(
      screen.queryByTestId("display-full-viewport-stage"),
    ).not.toBeInTheDocument();
  });

  it("unmounts the outgoing display lane only after its timeline completes", () => {
    const { rerender } = render(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        boxes={[baseBox]}
        prevBoxes={[]}
      />,
    );

    expect(screen.queryByTestId("display-box-prev")).not.toBeInTheDocument();

    rerender(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        boxes={[{ ...baseBox, id: "next-box" }]}
        prevBoxes={[baseBox]}
      />,
    );

    expect(screen.getByTestId("display-box-prev")).toBeInTheDocument();

    expect(screen.getByTestId("display-box-prev")).toBeInTheDocument();

    act(() => mockDisplayTransitionComplete?.());

    expect(screen.queryByTestId("display-box-prev")).not.toBeInTheDocument();
  });

  it("renders an outgoing lane when reused box ids have changed visual content", () => {
    const { rerender } = render(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        boxes={[
          { ...baseBox, id: "same-box", words: "Previous lyrics" },
        ]}
        prevBoxes={[]}
      />,
    );

    rerender(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        boxes={[{ ...baseBox, id: "same-box", words: "Current lyrics" }]}
        prevBoxes={[{ ...baseBox, id: "same-box", words: "Previous lyrics" }]}
      />,
    );

    expect(screen.getByTestId("display-box-prev")).toBeInTheDocument();
  });

  it("preserves the outgoing display box when reused ids receive changed visual content", () => {
    const { rerender } = render(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        boxes={[{ ...baseBox, id: "same-box", words: "Before" }]}
        prevBoxes={[]}
      />,
    );

    const firstCurrentBox = screen.getByTestId("display-box");

    rerender(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        boxes={[{ ...baseBox, id: "same-box", words: "After" }]}
        prevBoxes={[{ ...baseBox, id: "same-box", words: "Before" }]}
      />,
    );

    expect(screen.getByTestId("display-box")).not.toBe(firstCurrentBox);
    expect(screen.getByTestId("display-box")).toHaveAttribute(
      "data-words",
      "After",
    );
    expect(screen.getByTestId("display-box-prev")).toBe(firstCurrentBox);
    expect(screen.getByTestId("display-box-prev")).toHaveAttribute(
      "data-words",
      "Before",
    );
  });

  it("unmounts the previous stream text layer after the stream transition window", () => {
    jest.useFakeTimers();

    const { rerender } = render(
      <DisplayWindow displayType="stream" boxes={[baseBox]} prevBoxes={[]} />,
    );

    expect(
      screen.queryByTestId("display-stream-text-prev"),
    ).not.toBeInTheDocument();

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

    expect(
      screen.queryByTestId("display-stream-text-prev"),
    ).not.toBeInTheDocument();
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
    expect(
      screen.getByTestId("display-participant-overlay-mock"),
    ).toBeInTheDocument();
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(5_000);
    });

    expect(
      screen.getByTestId("display-participant-overlay-mock"),
    ).toBeInTheDocument();
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(249);
    });

    expect(
      screen.getByTestId("display-participant-overlay-mock"),
    ).toBeInTheDocument();
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(21);
    });

    expect(
      screen.queryByTestId("display-participant-overlay-mock"),
    ).not.toBeInTheDocument();
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

    expect(
      screen.queryByTestId("display-image-overlay-mock"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("stream-item-layer")).toHaveStyle({
      opacity: "1",
    });
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

    expect(
      screen.queryByTestId("display-participant-overlay-mock"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("stream-item-layer")).toHaveStyle({
      opacity: "1",
    });
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
    expect(
      screen.getByTestId("display-participant-overlay-mock"),
    ).toHaveAttribute("data-prev-name", "Alice");
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(1_250);
    });

    expect(
      screen.getByTestId("display-participant-overlay-mock"),
    ).toHaveAttribute("data-prev-name", "Alice");
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(249);
    });

    expect(
      screen.getByTestId("display-participant-overlay-mock"),
    ).toHaveAttribute("data-prev-name", "Alice");
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(21);
    });

    expect(
      screen.queryByTestId("display-participant-overlay-mock"),
    ).not.toBeInTheDocument();
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

    expect(
      screen.queryByTestId("display-participant-overlay-mock"),
    ).not.toBeInTheDocument();
    expect(streamItemLayer).toHaveStyle({ opacity: "1" });
  });

  it("restores stream item content shortly after an early board-post clear instead of waiting for the original duration", () => {
    jest.useFakeTimers();
    const t0 = new Date("2026-03-19T12:00:00.000Z").getTime();
    jest.setSystemTime(t0);

    const { rerender } = render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        boardPostStreamInfo={{
          author: "Alex",
          authorHexColor: "#0ea5e9",
          text: "Praying for you",
          time: t0,
          duration: 10,
          transitionSequence: 1,
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
        boardPostStreamInfo={{
          author: "",
          authorHexColor: "#e7e5e4",
          text: "",
          time: t0 + 250,
          transitionSequence: 2,
        }}
        prevBoardPostStreamInfo={{
          author: "Alex",
          authorHexColor: "#0ea5e9",
          text: "Praying for you",
          time: t0,
          duration: 10,
          transitionSequence: 1,
        }}
      />,
    );

    const streamItemLayer = screen.getByTestId("stream-item-layer");
    expect(
      screen.getByTestId("display-board-post-overlay-mock"),
    ).toHaveAttribute("data-prev-text", "Praying for you");
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(1_499);
    });

    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(21);
    });

    expect(
      screen.queryByTestId("display-board-post-overlay-mock"),
    ).not.toBeInTheDocument();
    expect(streamItemLayer).toHaveStyle({ opacity: "1" });
  });

  it("keeps a previous board-post exit mounted long enough when the clear reaches the device late", () => {
    jest.useFakeTimers();
    const t0 = new Date("2026-03-19T12:00:00.000Z").getTime();
    jest.setSystemTime(t0 + 250);

    render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        boardPostStreamInfo={{
          author: "",
          authorHexColor: "#e7e5e4",
          text: "",
          time: t0 + 250,
          transitionSequence: 2,
        }}
        prevBoardPostStreamInfo={{
          author: "Alex",
          authorHexColor: "#0ea5e9",
          text: "Late clear",
          time: t0,
          duration: 10,
          transitionSequence: 1,
        }}
      />,
    );

    const streamItemLayer = screen.getByTestId("stream-item-layer");
    expect(
      screen.getByTestId("display-board-post-overlay-mock"),
    ).toHaveAttribute("data-prev-text", "Late clear");
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(1_250);
    });

    expect(
      screen.getByTestId("display-board-post-overlay-mock"),
    ).toHaveAttribute("data-prev-text", "Late clear");
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(249);
    });

    expect(
      screen.getByTestId("display-board-post-overlay-mock"),
    ).toHaveAttribute("data-prev-text", "Late clear");
    expect(streamItemLayer).toHaveStyle({ opacity: "0" });

    act(() => {
      jest.advanceTimersByTime(21);
    });

    expect(
      screen.queryByTestId("display-board-post-overlay-mock"),
    ).not.toBeInTheDocument();
    expect(streamItemLayer).toHaveStyle({ opacity: "1" });
  });

  it("restores stream item content shortly after an early stb clear instead of waiting for the original duration", () => {
    jest.useFakeTimers();
    const t0 = new Date("2026-03-19T12:00:00.000Z").getTime();
    jest.setSystemTime(t0);

    const { rerender } = render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        stbOverlayInfo={{
          id: "stb-long",
          type: "stick-to-bottom",
          heading: "Welcome",
          time: t0,
          duration: 10,
          transitionSequence: 1,
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
        stbOverlayInfo={{
          id: "stb-cleared",
          type: "stick-to-bottom",
          time: t0 + 250,
          transitionSequence: 2,
        }}
        prevStbOverlayInfo={{
          id: "stb-long",
          type: "stick-to-bottom",
          heading: "Welcome",
          time: t0,
          duration: 10,
          transitionSequence: 1,
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

    expect(
      screen.queryByTestId("display-stb-overlay-mock"),
    ).not.toBeInTheDocument();
    expect(streamItemLayer).toHaveStyle({ opacity: "1" });
  });

  it("restores stream item content shortly after an early qr clear instead of waiting for the original duration", () => {
    jest.useFakeTimers();
    const t0 = new Date("2026-03-19T12:00:00.000Z").getTime();
    jest.setSystemTime(t0);

    const { rerender } = render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        qrCodeOverlayInfo={{
          id: "qr-long",
          type: "qr-code",
          url: "https://example.com/qr",
          description: "Scan",
          time: t0,
          duration: 10,
          transitionSequence: 1,
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
        qrCodeOverlayInfo={{
          id: "qr-cleared",
          type: "qr-code",
          time: t0 + 250,
          transitionSequence: 2,
        }}
        prevQrCodeOverlayInfo={{
          id: "qr-long",
          type: "qr-code",
          url: "https://example.com/qr",
          description: "Scan",
          time: t0,
          duration: 10,
          transitionSequence: 1,
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

    expect(
      screen.queryByTestId("display-qr-overlay-mock"),
    ).not.toBeInTheDocument();
    expect(streamItemLayer).toHaveStyle({ opacity: "1" });
  });

  it("restores stream item content shortly after an early image clear instead of waiting for the original duration", () => {
    jest.useFakeTimers();
    const t0 = new Date("2026-03-19T12:00:00.000Z").getTime();
    jest.setSystemTime(t0);

    const { rerender } = render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        imageOverlayInfo={{
          id: "img-long",
          type: "image",
          imageUrl: "https://cdn.example.com/photo.jpg",
          time: t0,
          duration: 10,
          transitionSequence: 1,
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
        imageOverlayInfo={{
          id: "img-cleared",
          type: "image",
          imageUrl: "",
          time: t0 + 250,
          transitionSequence: 2,
        }}
        prevImageOverlayInfo={{
          id: "img-long",
          type: "image",
          imageUrl: "https://cdn.example.com/photo.jpg",
          time: t0,
          duration: 10,
          transitionSequence: 1,
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

    expect(
      screen.queryByTestId("display-image-overlay-mock"),
    ).not.toBeInTheDocument();
    expect(streamItemLayer).toHaveStyle({ opacity: "1" });
  });

  it("keeps the stream item layer hidden while a live board post is active even when overlay-only is off", () => {
    jest.useFakeTimers();
    const t0 = new Date("2026-03-19T12:00:00.000Z").getTime();
    jest.setSystemTime(t0);

    render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        streamItemContentBlocked={false}
        boardPostStreamInfo={{
          author: "Alex",
          authorHexColor: "#0ea5e9",
          text: "Live post",
          time: t0,
          transitionSequence: 1,
        }}
      />,
    );

    expect(
      screen.getByTestId("display-board-post-overlay-mock"),
    ).toHaveAttribute("data-current-text", "Live post");
    expect(screen.getByTestId("stream-item-layer")).toHaveStyle({
      opacity: "0",
    });
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

    expect(screen.getByTestId("stream-item-layer")).toHaveStyle({
      opacity: "1",
    });
  });

  it("keeps the stream item layer visible while a cleared bible fades out through prev state", () => {
    const { rerender } = render(
      <DisplayWindow
        displayType="stream"
        shouldAnimate
        bibleDisplayInfo={{
          title: "Jn 3:16",
          text: "For God so loved",
          time: 1,
        }}
      />,
    );

    expect(screen.getByTestId("stream-item-layer")).toHaveStyle({
      opacity: "1",
    });

    // Clear empties current content but leaves the outgoing verse in prev for the fade-out.
    rerender(
      <DisplayWindow
        displayType="stream"
        shouldAnimate
        bibleDisplayInfo={{ title: "", text: "", time: 2 }}
        prevBibleDisplayInfo={{
          title: "Jn 3:16",
          text: "For God so loved",
          time: 1,
        }}
      />,
    );

    expect(screen.getByTestId("stream-item-layer")).toHaveStyle({
      opacity: "1",
    });
  });

  it("keeps the stream item layer visible while cleared formatted text fades out through prev state", () => {
    const { rerender } = render(
      <DisplayWindow
        displayType="stream"
        shouldAnimate
        formattedTextDisplayInfo={{ text: "Welcome", time: 1 }}
      />,
    );

    expect(screen.getByTestId("stream-item-layer")).toHaveStyle({
      opacity: "1",
    });

    rerender(
      <DisplayWindow
        displayType="stream"
        shouldAnimate
        formattedTextDisplayInfo={{ text: "", time: 2 }}
        prevFormattedTextDisplayInfo={{ text: "Welcome", time: 1 }}
      />,
    );

    expect(screen.getByTestId("stream-item-layer")).toHaveStyle({
      opacity: "1",
    });
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

    expect(
      screen.queryByTestId("display-participant-overlay-mock"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("display-image-overlay-mock"),
    ).toBeInTheDocument();
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
    render(
      <DisplayWindow
        displayType="editor"
        boxes={[baseBox, { ...baseBox, id: "b2" }]}
      />,
    );
    expect(screen.getAllByTestId("display-editor-mock")).toHaveLength(2);
  });

  it("uses high-quality local video receive in the display editor", () => {
    render(
      <DisplayWindow
        displayType="editor"
        boxes={[baseBox]}
        localVideoInput={{
          sourceId: "source-1",
          deviceLabel: "USB Capture",
          ownerDeviceId: "device-1",
          ownerLabel: "Booth",
        }}
        canCaptureLocalVideo
      />,
    );

    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-capture-enabled",
      "true",
    );
    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-high-quality",
      "true",
    );
  });

  it("shows a non-capturing local video status unless the surface opts in", () => {
    render(
      <DisplayWindow
        displayType="projector"
        boxes={[baseBox]}
        localVideoInput={{
          sourceId: "source-1",
          deviceLabel: "USB Capture",
          ownerDeviceId: "device-1",
          ownerLabel: "Booth",
        }}
      />,
    );
    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-capture-enabled",
      "false",
    );
    expect(screen.getByTestId("display-box")).toBeInTheDocument();
  });

  it("keeps projector chrome mounted over a local video input", () => {
    mockUseSelector.mockImplementation((selector) =>
      selector({
        ...baseState,
        displayOutputs: {
          list: [
            {
              id: "projector",
              type: "projector",
              name: "Main",
              order: 0,
              enabled: true,
              settings: {
                localVideoAudioEnabled: true,
                localVideoVolume: 40,
              },
            },
          ],
          isLoaded: true,
        },
      }),
    );
    render(
      <DisplayWindow
        displayType="projector"
        boxes={[baseBox]}
        localVideoInput={{
          sourceId: "source-1",
          deviceLabel: "USB Capture",
          ownerDeviceId: "device-1",
          ownerLabel: "Booth",
        }}
        canCaptureLocalVideo
        showClockTimer
      />,
    );

    expect(screen.getByTestId("local-video-input-view")).toHaveTextContent(
      "USB Capture",
    );
    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-play-audio",
      "true",
    );
    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-volume",
      "0.4",
    );
    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-capture-enabled",
      "false",
    );
    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-high-quality",
      "true",
    );
    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-show-errors",
      "false",
    );
    expect(screen.getByTestId("display-box")).toBeInTheDocument();
    expect(screen.getByTestId("projector-clock-timer")).toBeInTheDocument();
  });

  it("keeps monitor chrome and next-slide content around local video", () => {
    render(
      <DisplayWindow
        displayType="monitor"
        boxes={[baseBox]}
        nextBoxes={[{ ...baseBox, id: "next-local-video" }]}
        localVideoInput={{
          sourceId: "source-1",
          deviceLabel: "USB Capture",
          ownerDeviceId: "device-1",
          ownerLabel: "Booth",
        }}
        canCaptureLocalVideo
        showClockTimer
        monitorLayoutMode="full-monitor"
      />,
    );

    expect(screen.getByTestId("local-video-input-view")).toBeInTheDocument();
    expect(screen.getByTestId("monitor-view-mock")).toHaveAttribute(
      "data-show-next-slide",
      "true",
    );
    expect(screen.getByTestId("monitor-view-mock")).toHaveAttribute(
      "data-show-clock",
      "true",
    );
  });

  it("keeps stream local video visible and audible under an active overlay", () => {
    mockUseSelector.mockImplementation((selector) =>
      selector(streamStateWithLocalVideoAudio),
    );

    render(
      <DisplayWindow
        displayType="stream"
        boxes={[baseBox]}
        localVideoInput={localVideoInputFixture}
        canCaptureLocalVideo
        participantOverlayInfo={{
          id: "participant-over-video",
          type: "participant",
          name: "Alice",
        }}
      />,
    );

    expect(screen.getByTestId("current-local-video-layer")).toHaveStyle({
      opacity: "1",
    });
    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-play-audio",
      "true",
    );
    expect(screen.getByTestId("stream-item-layer")).toHaveStyle({
      opacity: "0",
    });
    expect(
      screen.getByTestId("display-participant-overlay-mock"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-transparent-background",
      "true",
    );
  });

  it("keeps current stream text lanes above local video", () => {
    const { rerender } = render(
      <DisplayWindow
        displayType="stream"
        localVideoInput={{
          sourceId: "source-1",
          deviceLabel: "USB Capture",
          ownerDeviceId: "device-1",
          ownerLabel: "Booth",
        }}
        bibleDisplayInfo={{
          title: "Outgoing verse",
          text: "Previous verse",
        }}
        formattedTextDisplayInfo={{ text: "Outgoing announcement" }}
      />,
    );

    rerender(
      <DisplayWindow
        displayType="stream"
        localVideoInput={{
          sourceId: "source-1",
          deviceLabel: "USB Capture",
          ownerDeviceId: "device-1",
          ownerLabel: "Booth",
        }}
        bibleDisplayInfo={{
          title: "Stale current verse",
          text: "Current verse",
        }}
        prevBibleDisplayInfo={{
          title: "Outgoing verse",
          text: "Previous verse",
        }}
        formattedTextDisplayInfo={{ text: "Stale current announcement" }}
        prevFormattedTextDisplayInfo={{ text: "Outgoing announcement" }}
      />,
    );

    expect(screen.getByTestId("display-stream-bible-mock")).toHaveAttribute(
      "data-current-title",
      "Stale current verse",
    );
    expect(screen.getByTestId("display-stream-bible-mock")).toHaveAttribute(
      "data-prev-title",
      "Outgoing verse",
    );
    expect(screen.getByTestId("display-formatted-text-mock")).toHaveAttribute(
      "data-current-text",
      "Stale current announcement",
    );
    expect(screen.getByTestId("display-formatted-text-mock")).toHaveAttribute(
      "data-prev-text",
      "Outgoing announcement",
    );
  });

  it("hides and mutes local video when stream content is hidden", () => {
    mockUseSelector.mockImplementation((selector) =>
      selector(streamStateWithLocalVideoAudio),
    );

    render(
      <DisplayWindow
        displayType="stream"
        streamItemContentBlocked
        canCaptureLocalVideo
        localVideoInput={localVideoInputFixture}
      />,
    );

    expect(screen.getByTestId("current-local-video-layer")).toHaveStyle({
      opacity: "0",
    });
    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-play-audio",
      "false",
    );
  });

  it("still hides and mutes local video when Hide Content is on during an overlay", () => {
    mockUseSelector.mockImplementation((selector) =>
      selector(streamStateWithLocalVideoAudio),
    );

    render(
      <DisplayWindow
        displayType="stream"
        streamItemContentBlocked
        canCaptureLocalVideo
        localVideoInput={localVideoInputFixture}
        participantOverlayInfo={{
          id: "participant-over-hidden-video",
          type: "participant",
          name: "Alice",
        }}
      />,
    );

    expect(screen.getByTestId("current-local-video-layer")).toHaveStyle({
      opacity: "0",
    });
    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-play-audio",
      "false",
    );
    expect(
      screen.getByTestId("display-participant-overlay-mock"),
    ).toBeInTheDocument();
  });

  it("keeps the outgoing local video lane for the slide crossfade", () => {
    const { rerender } = render(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        localVideoInput={{
          sourceId: "source-previous",
          deviceLabel: "Previous USB Capture",
          ownerDeviceId: "device-1",
          ownerLabel: "Booth",
        }}
      />,
    );

    expect(screen.getByTestId("current-lane-local-video")).toBeInTheDocument();
    const playingView = screen.getByTestId("local-video-input-view");
    const instanceId = playingView.getAttribute("data-instance-id");

    rerender(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        boxes={[baseBox]}
        prevLocalVideoInput={{
          sourceId: "source-previous",
          deviceLabel: "Previous USB Capture",
          ownerDeviceId: "device-1",
          ownerLabel: "Booth",
        }}
      />,
    );

    expect(screen.getByTestId("previous-lane-local-video")).toBeInTheDocument();
    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-instance-id",
      instanceId,
    );
    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-play-audio",
      "false",
    );
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "animating",
    );
    expect(screen.getByTestId("display-box")).toBeInTheDocument();
  });

  it("moves the playing video view into the outgoing lane without remounting", () => {
    const localVideoInput = {
      sourceId: "source-playing",
      deviceLabel: "Playing USB Capture",
      ownerDeviceId: "device-1",
      ownerLabel: "Booth",
    };
    const view = render(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        canCaptureLocalVideo
        localVideoInput={localVideoInput}
      />,
    );

    const playingView = screen.getByTestId("local-video-input-view");
    const instanceId = playingView.getAttribute("data-instance-id");
    expect(screen.getByTestId("current-lane-local-video")).toBeInTheDocument();

    view.rerender(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        canCaptureLocalVideo
        boxes={[baseBox]}
        prevLocalVideoInput={localVideoInput}
      />,
    );

    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-instance-id",
      instanceId,
    );
    expect(screen.getByTestId("previous-lane-local-video")).toBeInTheDocument();
    expect(screen.getByTestId("local-video-input-view")).toHaveAttribute(
      "data-play-audio",
      "false",
    );
  });

  it("keeps outgoing slide boxes while local video fades in", () => {
    const { rerender } = render(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        boxes={[{ ...baseBox, id: "outgoing-slide" }]}
      />,
    );

    rerender(
      <DisplayWindow
        displayType="projector"
        shouldAnimate
        localVideoInput={{
          sourceId: "source-1",
          deviceLabel: "USB Capture",
          ownerDeviceId: "device-1",
          ownerLabel: "Booth",
        }}
        prevBoxes={[{ ...baseBox, id: "outgoing-slide" }]}
      />,
    );

    expect(screen.getByTestId("current-lane-local-video")).toBeInTheDocument();
    expect(screen.getByTestId("display-box-prev")).toHaveAttribute(
      "data-box-id",
      "outgoing-slide",
    );
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

    const { rerender } = render(
      <DisplayWindow
        displayType="projector"
        boxes={[{ ...baseBox, id: "prev" }]}
        shouldAnimate
        shouldPlayVideo
      />,
    );

    rerender(
      <DisplayWindow
        displayType="projector"
        boxes={[videoBox]}
        prevBoxes={[{ ...baseBox, id: "prev" }]}
        shouldAnimate
        shouldPlayVideo
      />,
    );

    expect(screen.getByTestId("display-box")).toBeInTheDocument();
    expect(screen.getByTestId("display-box-prev")).toBeInTheDocument();

    expect(await screen.findByTestId("window-hls-player")).toBeInTheDocument();
  });

  it("keeps a controller projector preview on the preview playback role", async () => {
    const videoBox: Box = {
      ...baseBox,
      id: "preview-video-box",
      mediaInfo: {
        id: "preview-video",
        type: "video",
        background: "https://cdn.example.com/preview.mp4",
      } as NonNullable<Box["mediaInfo"]>,
    };

    render(
      <DisplayWindow
        displayType="projector"
        outputId="projector"
        boxes={[videoBox]}
        shouldPlayVideo
        videoPreloadRole="preview"
      />,
    );

    expect(await screen.findByTestId("window-hls-player")).toHaveAttribute(
      "data-playback-role",
      "preview",
    );
  });

  it("converges a projector preview through rapid A to B to C updates", () => {
    const sharedMedia = {
      id: "preview-shared-video",
      type: "video" as const,
      background: "https://cdn.example.com/preview-shared.mp4",
    };
    const slide = (words: string, id: string): Box => ({
      ...baseBox,
      id,
      words,
      mediaInfo: sharedMedia as NonNullable<Box["mediaInfo"]>,
    });
    const { rerender } = render(
      <DisplayWindow
        displayType="projector"
        outputId="projector"
        boxes={[slide("A", "slide-a")]}
        shouldPlayVideo
        shouldAnimate
        videoPreloadRole="preview"
      />,
    );

    rerender(
      <DisplayWindow
        displayType="projector"
        outputId="projector"
        boxes={[slide("B", "slide-b")]}
        prevBoxes={[slide("A", "slide-a")]}
        shouldPlayVideo
        shouldAnimate
        videoPreloadRole="preview"
      />,
    );
    const obsoleteComplete = mockDisplayTransitionComplete;

    rerender(
      <DisplayWindow
        displayType="projector"
        outputId="projector"
        boxes={[slide("C", "slide-c")]}
        prevBoxes={[slide("B", "slide-b")]}
        shouldPlayVideo
        shouldAnimate
        videoPreloadRole="preview"
      />,
    );

    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "animating",
    );
    expect(
      screen.getAllByTestId("display-box").map((node) => node.getAttribute("data-words")),
    ).toContain("C");
    expect(
      screen.getAllByTestId("display-box").map((node) => node.getAttribute("data-words")),
    ).not.toContain("B");

    act(() => obsoleteComplete?.());
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "animating",
    );

    act(() => mockDisplayTransitionComplete?.());
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "idle",
    );
    expect(
      screen.getAllByTestId("display-box").map((node) => node.getAttribute("data-words")),
    ).toEqual(["C"]);
  });

  it("publishes preparation only for output surfaces, not mounted previews", () => {
    const props = {
      displayType: "projector" as const,
      outputId: "projector",
      boxes: [baseBox],
    };
    const { rerender } = render(<DisplayWindow {...props} />);

    expect(
      mockPublishMediaPreparationManifest.mock.calls.at(-1)?.[0],
    ).toMatchObject({ enabled: true, outputId: "projector" });

    rerender(
      <DisplayWindow
        {...props}
        videoPreloadRole="preview"
      />,
    );

    expect(
      mockPublishMediaPreparationManifest.mock.calls.at(-1)?.[0],
    ).toMatchObject({ enabled: false, outputId: "projector" });
  });

  it("keeps the video poster up for media-cache URLs until the player is paint-ready", async () => {
    mockUseCachedVideoUrl.mockImplementation(
      (url?: string) =>
        url ? `media-cache://${encodeURIComponent(url)}` : undefined,
    );

    const videoBox: Box = {
      ...baseBox,
      id: "video-box",
      mediaInfo: {
        id: "m1",
        type: "video",
        background: "https://cdn.example.com/clip.mp4",
        placeholderImage: "https://cdn.example.com/clip.jpg",
      } as NonNullable<Box["mediaInfo"]>,
    };

    render(
      <DisplayWindow
        displayType="projector"
        boxes={[videoBox]}
        shouldPlayVideo
      />,
    );

    const player = await screen.findByTestId("window-hls-player");
    expect(player).toHaveAttribute(
      "data-src",
      "media-cache://https%3A%2F%2Fcdn.example.com%2Fclip.mp4",
    );
    expect(screen.getByTestId("display-box")).toHaveAttribute(
      "data-video-loaded",
      "false",
    );

    act(() => {
      player.click();
    });

    expect(screen.getByTestId("display-box")).toHaveAttribute(
      "data-video-loaded",
      "true",
    );
  });

  it("keeps the outgoing file video mounted in a previous lane during crossfade", async () => {
    const videoA: Box = {
      ...baseBox,
      id: "video-a",
      mediaInfo: {
        id: "video-a",
        type: "video",
        background: "https://cdn.example.com/a.mp4",
        placeholderImage: "https://cdn.example.com/a.jpg",
      } as NonNullable<Box["mediaInfo"]>,
    };
    const videoB: Box = {
      ...baseBox,
      id: "video-b",
      mediaInfo: {
        id: "video-b",
        type: "video",
        background: "https://cdn.example.com/b.mp4",
        placeholderImage: "https://cdn.example.com/b.jpg",
      } as NonNullable<Box["mediaInfo"]>,
    };

    const { rerender } = render(
      <DisplayWindow
        displayType="projector"
        boxes={[videoA]}
        shouldPlayVideo
        shouldAnimate
      />,
    );

    const firstPlayer = await screen.findByTestId("window-hls-player");
    act(() => {
      firstPlayer.click();
    });

    rerender(
      <DisplayWindow
        displayType="projector"
        boxes={[videoB]}
        prevBoxes={[videoA]}
        shouldPlayVideo
        shouldAnimate
      />,
    );

    expect(
      await screen.findByTestId("previous-lane-file-video"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("previous-lane-file-video")).toHaveAttribute(
      "data-paint-ready",
      "true",
    );
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "preparing",
    );

    const players = await screen.findAllByTestId("window-hls-player");
    expect(players.length).toBeGreaterThanOrEqual(2);
    const outgoing = players.find(
      (player) =>
        player.getAttribute("data-original-src") ===
        "https://cdn.example.com/a.mp4",
    );
    const incoming = players.find(
      (player) =>
        player.getAttribute("data-original-src") ===
        "https://cdn.example.com/b.mp4",
    );
    expect(outgoing).toBeTruthy();
    expect(outgoing).toHaveAttribute("data-muted", "true");
    expect(incoming).toBeTruthy();
    expect(screen.getByTestId("display-box-prev")).toHaveAttribute(
      "data-video-loaded",
      "true",
    );

    act(() => {
      incoming?.click();
    });

    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "animating",
    );
    expect(screen.getByTestId("previous-lane-file-video")).toBeInTheDocument();
    expect(screen.getByTestId("current-lane-file-video")).toHaveAttribute(
      "data-paint-ready",
      "true",
    );
    // Outgoing keeps the same player element through the fade.
    expect(outgoing).toBeInTheDocument();
  });

  it("crossfades live file video to an image without substituting a poster", async () => {
    const videoBox: Box = {
      ...baseBox,
      id: "video-out",
      words: "",
      mediaInfo: {
        id: "video-out",
        type: "video",
        background: "https://cdn.example.com/live.mp4",
        placeholderImage: "https://cdn.example.com/poster.jpg",
      } as NonNullable<Box["mediaInfo"]>,
    };
    const imageBox: Box = {
      ...baseBox,
      id: "image-in",
      words: "",
      background: "https://cdn.example.com/next.jpg",
    };

    const { rerender } = render(
      <DisplayWindow
        displayType="projector"
        boxes={[videoBox]}
        shouldPlayVideo
        shouldAnimate
      />,
    );

    const livePlayer = await screen.findByTestId("window-hls-player");
    act(() => {
      livePlayer.click();
    });
    expect(screen.getByTestId("current-lane-file-video")).toHaveAttribute(
      "data-paint-ready",
      "true",
    );

    rerender(
      <DisplayWindow
        displayType="projector"
        boxes={[imageBox]}
        prevBoxes={[videoBox]}
        shouldPlayVideo
        shouldAnimate
      />,
    );

    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "animating",
    );
    // Real outgoing <video> remains mounted — not replaced by the poster still.
    expect(screen.getByTestId("previous-lane-file-video")).toBeInTheDocument();
    expect(screen.getByTestId("window-hls-player")).toHaveAttribute(
      "data-original-src",
      "https://cdn.example.com/live.mp4",
    );
    expect(screen.getByTestId("window-hls-player")).toHaveAttribute(
      "data-muted",
      "true",
    );
    expect(
      screen.queryByTestId("previous-video-background-layer"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("display-box")).toBeInTheDocument();

    act(() => mockDisplayTransitionComplete?.());

    expect(
      screen.queryByTestId("previous-lane-file-video"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("window-hls-player")).not.toBeInTheDocument();
    expect(screen.getByTestId("display-box")).toBeInTheDocument();
  });

  it("keeps the exact file-video player across lyric-only slides with the same media", async () => {
    const sharedMedia = {
      id: "shared-video",
      type: "video" as const,
      background: "https://cdn.example.com/shared.mp4",
      placeholderImage: "https://cdn.example.com/shared.jpg",
    };
    const verse1: Box = {
      ...baseBox,
      id: "shared-box",
      words: "Verse 1",
      mediaInfo: sharedMedia as NonNullable<Box["mediaInfo"]>,
    };
    const verse2: Box = {
      ...verse1,
      words: "Verse 2",
    };

    const { rerender } = render(
      <DisplayWindow
        displayType="projector"
        boxes={[verse1]}
        shouldPlayVideo
        shouldAnimate
      />,
    );

    const player = await screen.findByTestId("window-hls-player");
    act(() => {
      player.click();
    });

    rerender(
      <DisplayWindow
        displayType="projector"
        boxes={[verse2]}
        prevBoxes={[verse1]}
        shouldPlayVideo
        shouldAnimate
      />,
    );

    expect(screen.getByTestId("window-hls-player")).toBe(player);
    expect(screen.getAllByTestId("window-hls-player")).toHaveLength(1);
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-mode",
      "content",
    );
    expect(mockDisplayTransitionTimeline.fromTo).toHaveBeenCalled();
    expect(screen.getByTestId("display-box-transition-content-a")).toBeInTheDocument();
    expect(screen.getByTestId("display-box-transition-content-b")).toBeInTheDocument();
    expect(screen.getByTestId("display-box-prev")).toHaveAttribute(
      "data-words",
      "Verse 1",
    );
    expect(screen.getByTestId("display-box")).toHaveAttribute(
      "data-words",
      "Verse 2",
    );
  });
});
