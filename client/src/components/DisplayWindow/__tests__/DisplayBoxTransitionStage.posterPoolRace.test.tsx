import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import type { MediaSurfaceStatus } from "../../../utils/mediaSurfaceLifecycle";
import DisplayBoxTransitionStage, {
  type DisplayBoxTransitionSnapshot,
} from "../DisplayBoxTransitionStage";

const mockPreparedPhases = new Map<string, MediaSurfaceStatus["phase"]>();
const mockTimeline = { addLabel: jest.fn(), fromTo: jest.fn(), kill: jest.fn() };

jest.mock("../../../hooks/useServiceVideoCandidates", () => ({
  useServiceVideoCandidates: ({
    currentMedia,
  }: {
    currentMedia?: { mediaKey: string; source: string; itemId?: string };
  }) => ({
    candidates: currentMedia ? [currentMedia] : [],
    diagnostics: [],
    discovery: {
      renderer: "projector",
      items: [],
      itemCount: 0,
      uniqueFiniteVideoCount: 0,
    },
    poolCapacity: 24,
    posterUrls: [],
  }),
}));

jest.mock("gsap", () => ({
  __esModule: true,
  default: {
    set: jest.fn(),
    timeline: jest.fn(() => mockTimeline),
  },
}));

jest.mock("../ElectronMediaSurfacePool", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: function MockElectronMediaSurfacePool({
      candidates,
      onStatusChange,
      route,
      role,
      outlineId,
    }: {
      candidates: Array<{ mediaKey: string; source: string }>;
      onStatusChange: (status: MediaSurfaceStatus) => void;
      route: string;
      role: string;
      outlineId?: string | null;
    }) {
      const lastPublished = React.useRef(new Map<string, string>());
      React.useEffect(() => {
        candidates.forEach((candidate) => {
          const phase = mockPreparedPhases.get(candidate.mediaKey) ?? "preparing";
          const signature = `${candidate.source}:${phase}`;
          if (lastPublished.current.get(candidate.mediaKey) === signature) return;
          lastPublished.current.set(candidate.mediaKey, signature);
          onStatusChange({
            mediaKey: candidate.mediaKey,
            sourceIdentity: candidate.source,
            generation: 1,
            route,
            role,
            outlineId,
            phase,
            geometryReady: true,
            advancingFrame: false,
            timestamp: 1,
          });
        });
      }, [candidates, onStatusChange, outlineId, role, route]);
      return <div data-testid="mock-prepared-pool" />;
    },
  };
});

jest.mock("../LaneFullFrameMedia", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    __esModule: true,
    default: function MockLaneFullFrameMedia({
      media,
      onPaintReadyChange,
      onLivePaintReadyChange,
      onPosterPaintReadyChange,
    }: {
      media: { kind: string; mediaKey?: string };
      onPaintReadyChange: (ready: boolean) => void;
      onLivePaintReadyChange?: (ready: boolean) => void;
      onPosterPaintReadyChange?: (ready: boolean) => void;
    }) {
      React.useEffect(() => {
        const posterReady = media.mediaKey === "remote:pool-race-b";
        onPaintReadyChange(true);
        onLivePaintReadyChange?.(!posterReady);
        onPosterPaintReadyChange?.(posterReady);
      }, [media.mediaKey, onLivePaintReadyChange, onPaintReadyChange, onPosterPaintReadyChange]);
      return <div data-testid={`fallback-${media.mediaKey}`} />;
    },
  };
});

const makeSnapshot = (key: string, mediaKey: string): DisplayBoxTransitionSnapshot => ({
  key,
  boxes: [{ id: "lyrics", words: key, width: 100, height: 100 }],
  backgroundMedia: {
    kind: "fileVideo",
    mediaKey,
    originalSrc: `https://cdn.example.com/${mediaKey}.mp4`,
    fallbackSrc: `https://cdn.example.com/${mediaKey}.jpg`,
    videoBox: { id: "video", words: "", width: 100, height: 100 },
  },
});

const TestLyrics = ({
  snapshot,
  reportBoxPaintReady,
}: {
  snapshot: DisplayBoxTransitionSnapshot;
  reportBoxPaintReady: (index: number, ready: boolean) => void;
}) => {
  useEffect(() => reportBoxPaintReady(0, true), [reportBoxPaintReady, snapshot.key]);
  return <div data-testid={`lyrics-${snapshot.boxes[0].words}`} />;
};

describe("DisplayBoxTransitionStage poster ownership with Electron preparation", () => {
  beforeEach(() => {
    mockPreparedPhases.clear();
    mockTimeline.addLabel.mockClear();
    mockTimeline.fromTo.mockClear();
    mockTimeline.kill.mockClear();
    mockPreparedPhases.set("remote:pool-race-a", "ready-paused");
    mockPreparedPhases.set("remote:pool-race-b", "preparing");
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        getLocalMediaPath: jest.fn().mockResolvedValue(null),
        isDev: jest.fn().mockResolvedValue(false),
      },
    });
  });

  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it("starts on B's poster and keeps its fallback owner when the pool becomes ready", () => {
    const first = makeSnapshot("Lyrics A", "remote:pool-race-a");
    const second = makeSnapshot("Lyrics B", "remote:pool-race-b");
    const mediaPlayback = {
      outputId: "projector",
      windowRole: "projector",
      currentItemId: "item-b",
      playbackRole: "output" as const,
      showBackground: true,
    };
    const renderLane = (
      snapshot: DisplayBoxTransitionSnapshot,
      _isPrevious: boolean,
      reportBoxPaintReady: (index: number, ready: boolean) => void,
    ) => <TestLyrics snapshot={snapshot} reportBoxPaintReady={reportBoxPaintReady} />;
    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={first}
        shouldAnimate
        mediaPlayback={mediaPlayback}
        renderLane={renderLane}
      />,
    );

    rerender(
      <DisplayBoxTransitionStage
        snapshot={second}
        shouldAnimate
        mediaPlayback={mediaPlayback}
        renderLane={renderLane}
      />,
    );

    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "animating",
    );
    expect(screen.getByTestId("lyrics-Lyrics B")).toBeInTheDocument();
    expect(screen.getByTestId("fallback-remote:pool-race-b")).toBeInTheDocument();
    const slideFadeCount = mockTimeline.fromTo.mock.calls.length;

    mockPreparedPhases.set("remote:pool-race-b", "ready-paused");
    rerender(
      <DisplayBoxTransitionStage
        snapshot={second}
        shouldAnimate
        mediaPlayback={mediaPlayback}
        renderLane={renderLane}
      />,
    );

    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "animating",
    );
    expect(screen.getByTestId("fallback-remote:pool-race-b")).toBeInTheDocument();
    expect(mockTimeline.fromTo).toHaveBeenCalledTimes(slideFadeCount);
  });
});
