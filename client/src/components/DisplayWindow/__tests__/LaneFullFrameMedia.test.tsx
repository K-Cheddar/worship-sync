import { render, screen } from "@testing-library/react";
import type { VideoBackgroundPlaybackCue } from "../../../types";
import LaneFullFrameMedia from "../LaneFullFrameMedia";

jest.mock("../../../hooks/useCachedMediaUrl", () => ({
  useCachedVideoUrl: (url?: string) => url,
}));

jest.mock("../HLSVideoPlayer", () => ({
  __esModule: true,
  default: ({
    playback,
  }: {
    playback?: VideoBackgroundPlaybackCue;
  }) => (
    <div
      data-testid="mock-hls-player"
      data-playback-media-key={playback?.mediaKey}
      data-playback-position={playback?.positionSeconds}
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
});
