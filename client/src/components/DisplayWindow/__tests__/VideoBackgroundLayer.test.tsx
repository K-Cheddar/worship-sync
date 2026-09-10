import { render, screen } from "@testing-library/react";
import VideoBackgroundLayer from "../VideoBackgroundLayer";

describe("VideoBackgroundLayer", () => {
  it("keeps the current lane hidden until paint-ready", () => {
    const { rerender } = render(
      <VideoBackgroundLayer laneKey="clip-a" paintReady={false}>
        <div>player</div>
      </VideoBackgroundLayer>,
    );

    expect(screen.getByTestId("current-video-background-layer")).toHaveAttribute(
      "data-visible",
      "false",
    );

    rerender(
      <VideoBackgroundLayer laneKey="clip-a" paintReady>
        <div>player</div>
      </VideoBackgroundLayer>,
    );

    expect(screen.getByTestId("current-video-background-layer")).toHaveAttribute(
      "data-visible",
      "true",
    );
  });

  it("holds the previous lane until crossfade is released", () => {
    const { rerender } = render(
      <VideoBackgroundLayer
        laneKey="clip-a"
        isPrevious
        shouldAnimate
        paintReady
        releaseCrossfade={false}
      >
        <div>player</div>
      </VideoBackgroundLayer>,
    );

    expect(
      screen.getByTestId("previous-video-background-layer"),
    ).toHaveAttribute("data-visible", "true");
    expect(
      screen.getByTestId("previous-video-background-layer"),
    ).toHaveAttribute("data-release-crossfade", "false");

    rerender(
      <VideoBackgroundLayer
        laneKey="clip-a"
        isPrevious
        shouldAnimate
        paintReady
        releaseCrossfade
      >
        <div>player</div>
      </VideoBackgroundLayer>,
    );

    expect(
      screen.getByTestId("previous-video-background-layer"),
    ).toHaveAttribute("data-visible", "false");
  });
});
