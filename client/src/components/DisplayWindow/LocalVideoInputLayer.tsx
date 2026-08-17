import { useLayoutEffect, useState } from "react";
import type { LocalVideoInputPresentation } from "../../types";
import LocalVideoInputView from "./LocalVideoInputView";

type LocalVideoInputLayerProps = {
  input: LocalVideoInputPresentation;
  isPrevious?: boolean;
  shouldAnimate?: boolean;
  playAudio?: boolean;
  volume?: number;
  captureEnabled?: boolean;
  receiveHighQuality?: boolean;
  publishPreview?: boolean;
  showErrors?: boolean;
  transparentBackground?: boolean;
  contentVisible?: boolean;
};

/** One current/previous media lane used to crossfade local capture sources. */
const LocalVideoInputLayer = ({
  input,
  isPrevious = false,
  shouldAnimate = false,
  playAudio = false,
  volume = 1,
  captureEnabled,
  receiveHighQuality,
  publishPreview,
  showErrors,
  transparentBackground,
  contentVisible = true,
}: LocalVideoInputLayerProps) => {
  const [transitionVisible, setTransitionVisible] = useState(
    shouldAnimate ? isPrevious : !isPrevious,
  );

  useLayoutEffect(() => {
    if (!shouldAnimate) {
      setTransitionVisible(!isPrevious);
      return;
    }
    setTransitionVisible(isPrevious);
    const frameId = window.requestAnimationFrame(() => {
      setTransitionVisible(!isPrevious);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [input.sourceId, isPrevious, shouldAnimate]);

  const visible = contentVisible && transitionVisible;

  return (
    <div
      className="pointer-events-none absolute inset-0 transition-opacity duration-500 ease-out"
      data-testid={
        isPrevious ? "previous-local-video-layer" : "current-local-video-layer"
      }
      style={{ opacity: visible ? 1 : 0 }}
    >
      <LocalVideoInputView
        input={input}
        playAudio={playAudio && visible}
        volume={volume}
        captureEnabled={captureEnabled}
        receiveHighQuality={receiveHighQuality}
        publishPreview={publishPreview}
        showErrors={showErrors}
        transparentBackground={transparentBackground}
      />
    </div>
  );
};

export default LocalVideoInputLayer;
