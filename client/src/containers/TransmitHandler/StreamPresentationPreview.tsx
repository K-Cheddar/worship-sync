import { ComponentProps, memo } from "react";
import PresentationPreview from "../../components/Presentation/PresentationPreview";
import { useSelector } from "../../hooks";

type PresentationQuickLinks = ComponentProps<typeof PresentationPreview>["quickLinks"];

type StreamPresentationPreviewProps = {
  quickLinks: PresentationQuickLinks;
  isMobile?: boolean;
  previewScale?: number;
  toggleIsTransmitting: () => void;
  variant: "default" | "overlayStreamFocus";
  showFocusedStreamControls: boolean;
};

const StreamPresentationPreview = memo(
  ({
    quickLinks,
    isMobile,
    previewScale,
    toggleIsTransmitting,
    variant,
    showFocusedStreamControls,
  }: StreamPresentationPreviewProps) => {
    const info = useSelector((state) => state.presentation.streamInfo);
    const prevInfo = useSelector((state) => state.presentation.prevStreamInfo);
    const isTransmitting = useSelector(
      (state) => state.presentation.isStreamTransmitting
    );
    const streamItemContentBlocked = useSelector(
      (state) => state.presentation.streamItemContentBlocked
    );
    const timers = useSelector((state) => state.timers.timers);
    const timerInfo = useSelector((state) =>
      state.timers.timers.find((timer) => timer.id === info.timerId)
    );
    const prevTimerInfo = useSelector((state) =>
      state.timers.timers.find((timer) => timer.id === prevInfo.timerId)
    );

    return (
      <PresentationPreview
        timers={timers}
        name="Stream"
        prevInfo={prevInfo}
        timerInfo={timerInfo}
        prevTimerInfo={prevTimerInfo}
        info={info}
        isTransmitting={isTransmitting}
        toggleIsTransmitting={toggleIsTransmitting}
        quickLinks={variant === "overlayStreamFocus" ? [] : quickLinks}
        hideQuickLinks={variant === "overlayStreamFocus"}
        hideHeader={variant === "overlayStreamFocus"}
        minimalHeader={variant === "overlayStreamFocus" && showFocusedStreamControls}
        isMobile={isMobile}
        streamItemContentBlocked={streamItemContentBlocked}
        previewScale={previewScale}
      />
    );
  }
);

export default StreamPresentationPreview;
