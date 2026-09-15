import { act, render, screen } from "@testing-library/react";
import { useEffect, type ReactElement } from "react";
import DisplayBoxTransitionStage, {
  type DisplayBoxTransitionSnapshot,
  type LaneRenderMediaOptions,
} from "../DisplayBoxTransitionStage";
import { NONE_LANE_BACKGROUND_MEDIA } from "../laneBackgroundMedia";

let mockTimelineComplete: (() => void) | undefined;
const mockTimeline = {
  addLabel: jest.fn(),
  fromTo: jest.fn(),
  kill: jest.fn(),
};
const mockGsapSet = jest.fn();

jest.mock("gsap", () => ({
  __esModule: true,
  default: {
    set: jest.fn((...args: unknown[]) => {
      mockGsapSet(...args);
    }),
    timeline: jest.fn((options?: { onComplete?: () => void }) => {
      mockTimelineComplete = options?.onComplete;
      return mockTimeline;
    }),
  },
}));

jest.mock("../LaneFullFrameMedia", () => ({
  __esModule: true,
  default: function MockLaneFullFrameMedia({
    onPaintReadyChange,
    media,
  }: {
    onPaintReadyChange: (ready: boolean) => void;
    media: { kind: string; mediaKey?: string; input?: { sourceId: string } };
  }) {
    useEffect(() => {
      onPaintReadyChange(true);
    }, [onPaintReadyChange]);
    const id =
      media.kind === "fileVideo"
        ? media.mediaKey
        : media.kind === "localVideo"
          ? media.input?.sourceId
          : "none";
    return <div data-testid="lane-full-frame-media-mock" data-media-id={id} />;
  },
}));

const oldSnapshot: DisplayBoxTransitionSnapshot = {
  key: "old::1000",
  boxes: [{ id: "box", words: "Old", width: 100, height: 100 }],
  backgroundMedia: NONE_LANE_BACKGROUND_MEDIA,
};
const newSnapshot: DisplayBoxTransitionSnapshot = {
  key: "new::2000",
  boxes: [{ id: "box", words: "New", width: 100, height: 100 }],
  backgroundMedia: NONE_LANE_BACKGROUND_MEDIA,
};
const latestSnapshot: DisplayBoxTransitionSnapshot = {
  key: "latest::3000",
  boxes: [{ id: "box", words: "Latest", width: 100, height: 100 }],
  backgroundMedia: NONE_LANE_BACKGROUND_MEDIA,
};

const sharedFileMedia = {
  kind: "fileVideo" as const,
  mediaKey: "remote:shared",
  originalSrc: "https://cdn.example.com/shared.mp4",
  videoBox: { id: "video", words: "", width: 100, height: 100 },
};

const LaneContent = ({
  snapshot,
  ready,
  reportPaintReady,
  laneMedia,
}: {
  snapshot: DisplayBoxTransitionSnapshot;
  ready: boolean;
  reportPaintReady: (index: number, ready: boolean) => void;
  laneMedia?: LaneRenderMediaOptions;
}) => {
  useEffect(() => {
    reportPaintReady(0, ready);
  }, [ready, reportPaintReady]);
  if (laneMedia && !laneMedia.paintForeground) {
    return (
      <div data-testid={`still-hold-${snapshot.boxes[0].words ?? "bg"}`} />
    );
  }
  return <div data-testid={`content-${snapshot.boxes[0].words}`} />;
};

const readyRenderLane =
  (ready = true) =>
    (
      snapshot: DisplayBoxTransitionSnapshot,
      _isPrevious: boolean,
      reportPaintReady: (index: number, ready: boolean) => void,
      laneMedia: LaneRenderMediaOptions,
    ) => (
      <LaneContent
        snapshot={snapshot}
        ready={ready}
        reportPaintReady={reportPaintReady}
        laneMedia={laneMedia}
      />
    );

describe("DisplayBoxTransitionStage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTimelineComplete = undefined;
  });

  it("preserves the outgoing DOM, waits for paint readiness, and cleans up on completion", () => {
    let incomingReady = false;
    const renderLane = (
      snapshot: DisplayBoxTransitionSnapshot,
      _isPrevious: boolean,
      reportPaintReady: (index: number, ready: boolean) => void,
      laneMedia: LaneRenderMediaOptions,
    ) => (
      <LaneContent
        snapshot={snapshot}
        ready={snapshot.key === oldSnapshot.key || incomingReady}
        reportPaintReady={reportPaintReady}
        laneMedia={laneMedia}
      />
    );
    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={oldSnapshot}
        shouldAnimate
        renderLane={renderLane}
      />,
    );
    const outgoingContent = screen.getByTestId("content-Old");

    rerender(
      <DisplayBoxTransitionStage
        snapshot={newSnapshot}
        shouldAnimate
        renderLane={renderLane}
      />,
    );

    expect(screen.getByTestId("content-Old")).toBe(outgoingContent);
    expect(screen.getByTestId("content-New")).toBeInTheDocument();
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "preparing",
    );
    expect(mockTimeline.fromTo).not.toHaveBeenCalled();

    incomingReady = true;
    rerender(
      <DisplayBoxTransitionStage
        snapshot={newSnapshot}
        shouldAnimate
        renderLane={renderLane}
      />,
    );

    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "animating",
    );
    expect(mockTimeline.fromTo).toHaveBeenCalled();
    expect(mockTimelineComplete).toBeDefined();
    expect(screen.getByTestId("content-Old")).toBe(outgoingContent);

    const incomingContent = screen.getByTestId("content-New");
    act(() => mockTimelineComplete?.());

    expect(screen.queryByTestId("content-Old")).not.toBeInTheDocument();
    expect(screen.getByTestId("content-New")).toBe(incomingContent);
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "idle",
    );
  });

  it("performs an atomic ready swap without starting an animation when disabled", () => {
    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={oldSnapshot}
        shouldAnimate={false}
        renderLane={readyRenderLane()}
      />,
    );

    rerender(
      <DisplayBoxTransitionStage
        snapshot={newSnapshot}
        shouldAnimate={false}
        renderLane={readyRenderLane()}
      />,
    );

    expect(screen.queryByTestId("content-Old")).not.toBeInTheDocument();
    expect(screen.getByTestId("content-New")).toBeInTheDocument();
    expect(mockTimeline.fromTo).not.toHaveBeenCalled();
  });

  it("serializes a newer slide request without restarting the active fade", () => {
    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={oldSnapshot}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );
    rerender(
      <DisplayBoxTransitionStage
        snapshot={newSnapshot}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );
    const callsAfterFirst = mockTimeline.fromTo.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    const firstTransitionComplete = mockTimelineComplete;

    rerender(
      <DisplayBoxTransitionStage
        snapshot={latestSnapshot}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );

    expect(mockTimeline.fromTo.mock.calls.length).toBe(callsAfterFirst);
    expect(screen.getByTestId("content-Old")).toBeInTheDocument();
    expect(screen.getByTestId("content-New")).toBeInTheDocument();
    expect(screen.queryByTestId("content-Latest")).not.toBeInTheDocument();

    act(() => firstTransitionComplete?.());

    expect(screen.queryByTestId("content-Old")).not.toBeInTheDocument();
    expect(screen.getByTestId("content-New")).toBeInTheDocument();
    expect(screen.getByTestId("content-Latest")).toBeInTheDocument();
    expect(mockTimeline.fromTo.mock.calls.length).toBeGreaterThan(
      callsAfterFirst,
    );
  });

  it("same background + same text does not transition", () => {
    const first: DisplayBoxTransitionSnapshot = {
      key: "slide-1",
      boxes: [{ id: "box", words: "Verse 1", width: 100, height: 100 }],
      backgroundMedia: sharedFileMedia,
    };
    const identical: DisplayBoxTransitionSnapshot = {
      ...first,
      key: "slide-1-retry",
      boxes: first.boxes,
      backgroundMedia: sharedFileMedia,
    };
    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={first}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );
    const media = screen.getByTestId("lane-full-frame-media-mock");

    rerender(
      <DisplayBoxTransitionStage
        snapshot={identical}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );

    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "idle",
    );
    expect(screen.getByTestId("lane-full-frame-media-mock")).toBe(media);
    expect(mockTimeline.fromTo).not.toHaveBeenCalled();
  });

  it("same video + changed text crossfades content without duplicating media", () => {
    const first: DisplayBoxTransitionSnapshot = {
      key: "slide-1",
      boxes: [{ id: "box", words: "Verse 1", width: 100, height: 100 }],
      backgroundMedia: sharedFileMedia,
    };
    const second: DisplayBoxTransitionSnapshot = {
      key: "slide-2",
      boxes: [{ id: "box", words: "Verse 2", width: 100, height: 100 }],
      backgroundMedia: sharedFileMedia,
    };
    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={first}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );
    const media = screen.getByTestId("lane-full-frame-media-mock");

    rerender(
      <DisplayBoxTransitionStage
        snapshot={second}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );

    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-mode",
      "content",
    );
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "animating",
    );
    expect(screen.getByTestId("content-Verse 1")).toBeInTheDocument();
    expect(screen.getByTestId("content-Verse 2")).toBeInTheDocument();
    expect(screen.getAllByTestId("lane-full-frame-media-mock")).toHaveLength(1);
    expect(screen.getByTestId("lane-full-frame-media-mock")).toBe(media);
    expect(mockTimeline.fromTo).toHaveBeenCalled();

    act(() => mockTimelineComplete?.());

    expect(screen.queryByTestId("content-Verse 1")).not.toBeInTheDocument();
    expect(screen.getByTestId("content-Verse 2")).toBeInTheDocument();
    expect(screen.getAllByTestId("lane-full-frame-media-mock")).toHaveLength(1);
    expect(screen.getByTestId("lane-full-frame-media-mock")).toBe(media);
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-phase",
      "idle",
    );
  });

  it("same image + changed text keeps a still hold and crossfades text", () => {
    const imageBoxes = (words: string) => [
      {
        id: "box",
        words,
        width: 100,
        height: 100,
        background: "https://cdn.example.com/bg.jpg",
      },
    ];
    const first: DisplayBoxTransitionSnapshot = {
      key: "img-1",
      boxes: imageBoxes("Line 1"),
      backgroundMedia: NONE_LANE_BACKGROUND_MEDIA,
    };
    const second: DisplayBoxTransitionSnapshot = {
      key: "img-2",
      boxes: imageBoxes("Line 2"),
      backgroundMedia: NONE_LANE_BACKGROUND_MEDIA,
    };
    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={first}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );

    rerender(
      <DisplayBoxTransitionStage
        snapshot={second}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );

    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-mode",
      "content",
    );
    expect(screen.getByTestId("still-hold-Line 1")).toBeInTheDocument();
    expect(screen.getByTestId("content-Line 1")).toBeInTheDocument();
    expect(screen.getByTestId("content-Line 2")).toBeInTheDocument();
    expect(mockTimeline.fromTo).toHaveBeenCalled();
  });

  it("same local video + changed text keeps a single capture surface", () => {
    const localMedia = {
      kind: "localVideo" as const,
      input: {
        sourceId: "cam-1",
        deviceLabel: "Cam",
        ownerDeviceId: "d1",
        ownerLabel: "Booth",
      },
    };
    const first: DisplayBoxTransitionSnapshot = {
      key: "local-1",
      boxes: [{ id: "box", words: "A", width: 100, height: 100 }],
      backgroundMedia: localMedia,
    };
    const second: DisplayBoxTransitionSnapshot = {
      key: "local-2",
      boxes: [{ id: "box", words: "B", width: 100, height: 100 }],
      backgroundMedia: localMedia,
    };
    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={first}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );
    const media = screen.getByTestId("lane-full-frame-media-mock");

    rerender(
      <DisplayBoxTransitionStage
        snapshot={second}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );

    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-mode",
      "content",
    );
    expect(screen.getAllByTestId("lane-full-frame-media-mock")).toHaveLength(1);
    expect(screen.getByTestId("lane-full-frame-media-mock")).toBe(media);
    expect(screen.getByTestId("content-A")).toBeInTheDocument();
    expect(screen.getByTestId("content-B")).toBeInTheDocument();
  });

  it("changed background + same text uses a media-only transition", () => {
    const mediaA = {
      ...sharedFileMedia,
      mediaKey: "remote:a",
      originalSrc: "https://cdn.example.com/a.mp4",
    };
    const mediaB = {
      ...sharedFileMedia,
      mediaKey: "remote:b",
      originalSrc: "https://cdn.example.com/b.mp4",
    };
    const first: DisplayBoxTransitionSnapshot = {
      key: "bg-1",
      boxes: [{ id: "box", words: "Same", width: 100, height: 100 }],
      backgroundMedia: mediaA,
    };
    const second: DisplayBoxTransitionSnapshot = {
      key: "bg-2",
      boxes: [{ id: "box", words: "Same", width: 100, height: 100 }],
      backgroundMedia: mediaB,
    };
    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={first}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );
    const text = screen.getByTestId("content-Same");

    rerender(
      <DisplayBoxTransitionStage
        snapshot={second}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );

    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-mode",
      "media",
    );
    expect(screen.getByTestId("content-Same")).toBe(text);
    expect(screen.getAllByTestId("content-Same")).toHaveLength(1);
    expect(screen.getAllByTestId("lane-full-frame-media-mock")).toHaveLength(2);
    expect(mockTimeline.fromTo).toHaveBeenCalled();
  });

  it("changed background + changed text uses a full transition", () => {
    const mediaA = {
      ...sharedFileMedia,
      mediaKey: "remote:a",
      originalSrc: "https://cdn.example.com/a.mp4",
    };
    const mediaB = {
      ...sharedFileMedia,
      mediaKey: "remote:b",
      originalSrc: "https://cdn.example.com/b.mp4",
    };
    const first: DisplayBoxTransitionSnapshot = {
      key: "both-1",
      boxes: [{ id: "box", words: "One", width: 100, height: 100 }],
      backgroundMedia: mediaA,
    };
    const second: DisplayBoxTransitionSnapshot = {
      key: "both-2",
      boxes: [{ id: "box", words: "Two", width: 100, height: 100 }],
      backgroundMedia: mediaB,
    };
    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={first}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );

    rerender(
      <DisplayBoxTransitionStage
        snapshot={second}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );

    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-mode",
      "full",
    );
    expect(screen.getByTestId("content-One")).toBeInTheDocument();
    expect(screen.getByTestId("content-Two")).toBeInTheDocument();
    expect(screen.getAllByTestId("lane-full-frame-media-mock")).toHaveLength(2);
  });

  it("rapid same-background lyric changes keep one media surface and coalesce text", () => {
    const verse = (n: number): DisplayBoxTransitionSnapshot => ({
      key: `v-${n}`,
      boxes: [{ id: "box", words: `Verse ${n}`, width: 100, height: 100 }],
      backgroundMedia: sharedFileMedia,
    });
    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={verse(1)}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );
    const media = screen.getByTestId("lane-full-frame-media-mock");

    rerender(
      <DisplayBoxTransitionStage
        snapshot={verse(2)}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );
    const firstComplete = mockTimelineComplete;
    rerender(
      <DisplayBoxTransitionStage
        snapshot={verse(3)}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );

    expect(screen.getAllByTestId("lane-full-frame-media-mock")).toHaveLength(1);
    expect(screen.getByTestId("lane-full-frame-media-mock")).toBe(media);
    expect(screen.getByTestId("content-Verse 1")).toBeInTheDocument();
    expect(screen.getByTestId("content-Verse 2")).toBeInTheDocument();
    expect(screen.queryByTestId("content-Verse 3")).not.toBeInTheDocument();

    act(() => firstComplete?.());

    expect(screen.getAllByTestId("lane-full-frame-media-mock")).toHaveLength(1);
    expect(screen.getByTestId("lane-full-frame-media-mock")).toBe(media);
    expect(screen.queryByTestId("content-Verse 1")).not.toBeInTheDocument();
    expect(screen.getByTestId("content-Verse 2")).toBeInTheDocument();
    expect(screen.getByTestId("content-Verse 3")).toBeInTheDocument();

    act(() => mockTimelineComplete?.());

    expect(screen.queryByTestId("content-Verse 2")).not.toBeInTheDocument();
    expect(screen.getByTestId("content-Verse 3")).toBeInTheDocument();
    expect(screen.getAllByTestId("lane-full-frame-media-mock")).toHaveLength(1);
    expect(screen.getByTestId("lane-full-frame-media-mock")).toBe(media);
  });

  const assertContentCrossfadeContract = (
    outgoingWords: string,
    incomingWords: string,
  ) => {
    const stage = screen.getByTestId("display-box-transition-stage");
    expect(stage).toHaveAttribute("data-transition-mode", "content");
    expect(stage).toHaveAttribute("data-transition-phase", "animating");

    expect(screen.getByTestId("display-box-transition-media-plane")).toHaveStyle(
      { zIndex: "0" },
    );
    expect(
      screen.getByTestId("display-box-transition-content-plane"),
    ).toHaveStyle({ zIndex: "10" });

    expect(screen.getByTestId(`content-${outgoingWords}`)).toBeInTheDocument();
    expect(screen.getByTestId(`content-${incomingWords}`)).toBeInTheDocument();
    expect(screen.getAllByTestId("lane-full-frame-media-mock")).toHaveLength(1);
    expect(mockTimeline.fromTo).toHaveBeenCalled();
  };

  it("content transition with A active keeps both foregrounds until completion", () => {
    const first: DisplayBoxTransitionSnapshot = {
      key: "a-1",
      boxes: [{ id: "box", words: "A1", width: 100, height: 100 }],
      backgroundMedia: sharedFileMedia,
    };
    const second: DisplayBoxTransitionSnapshot = {
      key: "a-2",
      boxes: [{ id: "box", words: "A2", width: 100, height: 100 }],
      backgroundMedia: sharedFileMedia,
    };
    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={first}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-active-lane",
      "a",
    );

    rerender(
      <DisplayBoxTransitionStage
        snapshot={second}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );

    assertContentCrossfadeContract("A1", "A2");
    expect(screen.getByTestId("display-box-transition-content-a")).toHaveAttribute(
      "data-lane-role",
      "outgoing",
    );
    expect(screen.getByTestId("display-box-transition-content-b")).toHaveAttribute(
      "data-lane-role",
      "incoming",
    );
    const winningContent = screen.getByTestId("content-A2");

    act(() => mockTimelineComplete?.());

    // Winning foreground stays on the incoming lane — no remount onto the
    // media-anchor lane that just faded out.
    expect(screen.queryByTestId("content-A1")).not.toBeInTheDocument();
    expect(screen.getByTestId("content-A2")).toBe(winningContent);
    expect(
      screen.queryByTestId("display-box-transition-content-a"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("display-box-transition-content-b")).toHaveStyle({
      opacity: "1",
    });
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-active-lane",
      "b",
    );
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-media-anchor-lane",
      "a",
    );
    expect(mockGsapSet).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clearProps: "opacity" }),
    );
  });

  it("content transition with B active keeps the same crossfade contract", () => {
    const mediaA = {
      ...sharedFileMedia,
      mediaKey: "remote:song-a",
      originalSrc: "https://cdn.example.com/song-a.mp4",
    };
    const mediaB = {
      ...sharedFileMedia,
      mediaKey: "remote:song-b",
      originalSrc: "https://cdn.example.com/song-b.mp4",
    };
    // Full transition promotes active lane to B.
    const songA: DisplayBoxTransitionSnapshot = {
      key: "song-a",
      boxes: [{ id: "box", words: "SongA", width: 100, height: 100 }],
      backgroundMedia: mediaA,
    };
    const songB1: DisplayBoxTransitionSnapshot = {
      key: "song-b-1",
      boxes: [{ id: "box", words: "B1", width: 100, height: 100 }],
      backgroundMedia: mediaB,
    };
    const songB2: DisplayBoxTransitionSnapshot = {
      key: "song-b-2",
      boxes: [{ id: "box", words: "B2", width: 100, height: 100 }],
      backgroundMedia: mediaB,
    };

    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={songA}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );
    rerender(
      <DisplayBoxTransitionStage
        snapshot={songB1}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-transition-mode",
      "full",
    );
    act(() => mockTimelineComplete?.());
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-active-lane",
      "b",
    );
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-media-anchor-lane",
      "b",
    );

    jest.clearAllMocks();
    mockTimelineComplete = undefined;

    rerender(
      <DisplayBoxTransitionStage
        snapshot={songB2}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );

    assertContentCrossfadeContract("B1", "B2");
    // B is outgoing; A is incoming — content plane must still sit above media.
    expect(screen.getByTestId("display-box-transition-content-b")).toHaveAttribute(
      "data-lane-role",
      "outgoing",
    );
    expect(screen.getByTestId("display-box-transition-content-a")).toHaveAttribute(
      "data-lane-role",
      "incoming",
    );
    expect(screen.getByTestId("display-box-transition-media-b")).toBeInTheDocument();
    expect(
      screen.queryByTestId("display-box-transition-media-a"),
    ).not.toBeInTheDocument();
    const winningContent = screen.getByTestId("content-B2");

    act(() => mockTimelineComplete?.());

    expect(screen.queryByTestId("content-B1")).not.toBeInTheDocument();
    expect(screen.getByTestId("content-B2")).toBe(winningContent);
    expect(
      screen.queryByTestId("display-box-transition-content-b"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("display-box-transition-content-a")).toHaveStyle({
      opacity: "1",
    });
    // Content owned by incoming lane A; media remains on prior anchor B.
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-active-lane",
      "a",
    );
    expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
      "data-media-anchor-lane",
      "b",
    );
    expect(screen.getByTestId("display-box-transition-media-b")).toBeInTheDocument();
    expect(mockGsapSet).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clearProps: "opacity" }),
    );
  });

  it("alternating full song changes then content fades stay symmetric across four songs", () => {
    const song = (n: number, verse: number): DisplayBoxTransitionSnapshot => ({
      key: `song-${n}-v${verse}`,
      boxes: [{ id: "box", words: `S${n}V${verse}`, width: 100, height: 100 }],
      backgroundMedia: {
        ...sharedFileMedia,
        mediaKey: `remote:song-${n}`,
        originalSrc: `https://cdn.example.com/song-${n}.mp4`,
      },
    });

    const runSongLyricFade = (
      rerender: (ui: ReactElement) => void,
      n: number,
    ) => {
      jest.clearAllMocks();
      mockTimelineComplete = undefined;
      rerender(
        <DisplayBoxTransitionStage
          snapshot={song(n, 2)}
          shouldAnimate
          renderLane={readyRenderLane()}
        />,
      );
      assertContentCrossfadeContract(`S${n}V1`, `S${n}V2`);
      const complete = mockTimelineComplete;
      act(() => complete?.());
      expect(screen.getByTestId(`content-S${n}V2`)).toBeInTheDocument();
      expect(screen.queryByTestId(`content-S${n}V1`)).not.toBeInTheDocument();
      expect(
        screen.getByTestId("display-box-transition-content-plane"),
      ).toHaveStyle({ zIndex: "10" });
      expect(
        screen.getByTestId("display-box-transition-media-plane"),
      ).toHaveStyle({ zIndex: "0" });
    };

    const switchSong = (
      rerender: (ui: ReactElement) => void,
      n: number,
    ) => {
      rerender(
        <DisplayBoxTransitionStage
          snapshot={song(n, 1)}
          shouldAnimate
          renderLane={readyRenderLane()}
        />,
      );
      expect(screen.getByTestId("display-box-transition-stage")).toHaveAttribute(
        "data-transition-mode",
        "full",
      );
      const complete = mockTimelineComplete;
      act(() => complete?.());
    };

    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={song(1, 1)}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );

    runSongLyricFade(rerender, 1);
    switchSong(rerender, 2);
    runSongLyricFade(rerender, 2);
    switchSong(rerender, 3);
    runSongLyricFade(rerender, 3);
    switchSong(rerender, 4);
    runSongLyricFade(rerender, 4);
  });

  it("does not re-expose previous lyrics after content settle", () => {
    const verse = (n: number): DisplayBoxTransitionSnapshot => ({
      key: `v-${n}`,
      boxes: [{ id: "box", words: `Verse ${n}`, width: 100, height: 100 }],
      backgroundMedia: sharedFileMedia,
    });
    const { rerender } = render(
      <DisplayBoxTransitionStage
        snapshot={verse(1)}
        shouldAnimate
        renderLane={readyRenderLane()}
      />,
    );

    const advance = (from: number, to: number) => {
      jest.clearAllMocks();
      mockTimelineComplete = undefined;
      rerender(
        <DisplayBoxTransitionStage
          snapshot={verse(to)}
          shouldAnimate
          renderLane={readyRenderLane()}
        />,
      );
      const outgoing = screen.getByTestId(`content-Verse ${from}`);
      const incoming = screen.getByTestId(`content-Verse ${to}`);
      expect(outgoing).toBeInTheDocument();
      expect(incoming).toBeInTheDocument();
      const complete = mockTimelineComplete;
      act(() => complete?.());
      expect(screen.queryByTestId(`content-Verse ${from}`)).not.toBeInTheDocument();
      expect(screen.getByTestId(`content-Verse ${to}`)).toBe(incoming);
      expect(mockGsapSet).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ clearProps: "opacity" }),
      );
    };

    advance(1, 2);
    advance(2, 3);
    advance(3, 4);
    advance(4, 5);
  });
});
