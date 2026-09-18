import { fireEvent, render, screen } from "@testing-library/react";
import type { VideoBackgroundPlaybackCue } from "../../../types";
import LaneFullFrameMedia from "../LaneFullFrameMedia";

jest.mock("../../../hooks/useCachedMediaUrl", () => ({
  useCachedVideoUrl: (url?: string) => url,
}));

jest.mock("../HLSVideoPlayer", () => ({
  __esModule: true,
  default: ({
    playback,
    paintReady,
    onLoadedData,
  }: {
    playback?: VideoBackgroundPlaybackCue;
    paintReady?: boolean;
    onLoadedData?: () => void;
  }) => (
    <div
      data-testid="mock-hls-player"
      data-playback-media-key={playback?.mediaKey}
      data-playback-position={playback?.positionSeconds}
      data-paint-ready={paintReady ? "true" : "false"}
      onClick={onLoadedData}
    />
  ),
}));

describe("LaneFullFrameMedia", () => {
  it("keeps the outgoing playback cue when the lane becomes previous", () => {
    const playback: VideoBackgroundPlaybackCue = {
      mediaKey: "remote:video-a",
      positionSeconds: 17,
      paused: false,
      atServerMs: 1_000_000,
      generation: 4,
      applySeek: false,
    };
    const media = {
      kind: "fileVideo" as const,
      mediaKey: "remote:video-a",
      originalSrc: "media-cache://video-a.mp4",
      videoBox: {
        id: "video-a",
        width: 100,
        height: 100,
        words: "",
      },
    };

    const { rerender } = render(
      <LaneFullFrameMedia
        media={media}
        isPrevious={false}
        onPaintReadyChange={() => undefined}
        playback={playback}
      />,
    );

    const playerBefore = screen.getByTestId("mock-hls-player");
    rerender(
      <LaneFullFrameMedia
        media={media}
        isPrevious
        onPaintReadyChange={() => undefined}
        playback={playback}
      />,
    );

    expect(screen.getByTestId("mock-hls-player")).toBe(playerBefore);
    expect(screen.getByTestId("mock-hls-player")).toHaveAttribute(
      "data-playback-media-key",
      "remote:video-a",
    );
    expect(screen.getByTestId("mock-hls-player")).toHaveAttribute(
      "data-playback-position",
      "17",
    );
  });

  it("reports a loaded fallback as lane-ready before the live video paints", () => {
    const visualReady = jest.fn();
    const liveReady = jest.fn();
    const media = {
      kind: "fileVideo" as const,
      mediaKey: "remote:video-b",
      originalSrc: "https://cdn.example.com/video-b.mp4",
      fallbackSrc: "https://cdn.example.com/video-b.jpg",
      videoBox: { id: "video-b", width: 100, height: 100, words: "" },
    };

    render(
      <LaneFullFrameMedia
        media={media}
        isPrevious={false}
        onPaintReadyChange={visualReady}
        onLivePaintReadyChange={liveReady}
      />,
    );

    fireEvent.load(screen.getByTestId("file-video-fallback"));

    expect(visualReady).toHaveBeenLastCalledWith(true);
    expect(liveReady).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId("mock-hls-player")).toHaveAttribute(
      "data-paint-ready",
      "false",
    );
  });

  it("keeps the fallback authoritative until the live player reports a painted frame", () => {
    const media = {
      kind: "fileVideo" as const,
      mediaKey: "remote:video-c",
      originalSrc: "https://cdn.example.com/video-c.mp4",
      fallbackSrc: "https://cdn.example.com/video-c.jpg",
      videoBox: { id: "video-c", width: 100, height: 100, words: "" },
    };

    render(
      <LaneFullFrameMedia
        media={media}
        isPrevious={false}
        onPaintReadyChange={() => undefined}
        onLivePaintReadyChange={() => undefined}
      />,
    );
    const fallback = screen.getByTestId("file-video-fallback");
    const player = screen.getByTestId("mock-hls-player");

    fireEvent.load(fallback);
    expect(fallback).toHaveStyle({ opacity: "1" });
    expect(player).toHaveAttribute("data-paint-ready", "false");

    fireEvent.click(player);

    expect(fallback).toHaveStyle({ opacity: "0" });
    expect(player).toHaveAttribute("data-paint-ready", "true");
  });
});
