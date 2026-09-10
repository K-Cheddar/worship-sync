import { useLayoutEffect, useState, type ReactNode } from "react";

type VideoBackgroundLayerProps = {
  laneKey: string;
  isPrevious?: boolean;
  shouldAnimate?: boolean;
  /** Current lane stays hidden until the player reports paint-ready. */
  paintReady?: boolean;
  /**
   * Previous lane stays fully visible until this flips true so the outgoing
   * clip does not fade into black while the incoming clip is still decoding.
   */
  releaseCrossfade?: boolean;
  children: ReactNode;
};

/**
 * One current/previous file-video lane. Mirrors LocalVideoInputLayer so outgoing
 * video can keep playing through the fade instead of collapsing to a still.
 *
 * Crossfade timing: hold the previous lane until `releaseCrossfade`, and keep
 * the current lane at opacity 0 until `paintReady`. When both flip together the
 * 500ms opacity transitions overlap — no black gap between cached clips.
 *
 * The current lane does not wait on rAF to arm its fade. `paintReady` alone
 * gates opacity so the reveal starts in the same frame the previous lane
 * releases.
 */
const VideoBackgroundLayer = ({
  laneKey,
  isPrevious = false,
  shouldAnimate = false,
  paintReady = true,
  releaseCrossfade = true,
  children,
}: VideoBackgroundLayerProps) => {
  const [transitionVisible, setTransitionVisible] = useState(
    shouldAnimate ? isPrevious : !isPrevious,
  );

  useLayoutEffect(() => {
    if (!shouldAnimate) {
      setTransitionVisible(!isPrevious);
      return;
    }

    if (isPrevious) {
      // Hold at full opacity until the incoming lane can join the crossfade.
      setTransitionVisible(!releaseCrossfade);
      return;
    }

    // Current lane stays armed; paintReady controls whether opacity is 1.
    setTransitionVisible(true);
  }, [laneKey, isPrevious, shouldAnimate, releaseCrossfade]);

  const visible =
    transitionVisible && (isPrevious || paintReady);

  return (
    <div
      className="pointer-events-none absolute inset-0 transition-opacity duration-500 ease-out"
      data-testid={
        isPrevious
          ? "previous-video-background-layer"
          : "current-video-background-layer"
      }
      data-lane-key={laneKey}
      data-paint-ready={paintReady ? "true" : "false"}
      data-release-crossfade={releaseCrossfade ? "true" : "false"}
      data-visible={visible ? "true" : "false"}
      style={{ opacity: visible ? 1 : 0 }}
    >
      {children}
    </div>
  );
};

export default VideoBackgroundLayer;
