import { ComponentProps, memo } from "react";
import PresentationPreview from "../../components/Presentation/PresentationPreview";
import { useSelector } from "../../hooks";
import { selectOutputSlot } from "../../store/presentationSlice";

type PresentationQuickLinks = ComponentProps<
  typeof PresentationPreview
>["quickLinks"];

type StreamPresentationPreviewProps = {
  quickLinks: PresentationQuickLinks;
  isMobile?: boolean;
  previewScale?: number;
  fillWidth?: boolean;
  readOnly?: boolean;
  toggleIsTransmitting: () => void;
  variant: "default" | "overlayStreamFocus";
  showFocusedStreamControls: boolean;
};

const StreamPresentationPreview = memo(
  ({
    quickLinks,
    isMobile,
    previewScale,
    fillWidth,
    readOnly = false,
    toggleIsTransmitting,
    variant,
    showFocusedStreamControls,
  }: StreamPresentationPreviewProps) => {
    const info = useSelector(
      (state) => selectOutputSlot(state, "stream", "stream").info,
    );
    const prevInfo = useSelector(
      (state) => selectOutputSlot(state, "stream", "stream").prevInfo,
    );
    const isTransmitting = useSelector(
      (state) => selectOutputSlot(state, "stream", "stream").isTransmitting,
    );
    const streamItemContentBlocked = useSelector(
      (state) => selectOutputSlot(state, "stream", "stream").itemContentBlocked,
    );
    const timers = useSelector((state) => state.timers.timers);
    const timerInfo = useSelector((state) =>
      state.timers.timers.find((timer) => timer.id === info.timerId),
    );
    const prevTimerInfo = useSelector((state) =>
      state.timers.timers.find((timer) => timer.id === prevInfo.timerId),
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
        hideQuickLinks={readOnly || variant === "overlayStreamFocus"}
        hideHeader={variant === "overlayStreamFocus"}
        minimalHeader={
          readOnly ||
          (variant === "overlayStreamFocus" && showFocusedStreamControls)
        }
        isMobile={isMobile}
        streamItemContentBlocked={streamItemContentBlocked}
        previewScale={previewScale}
        fillWidth={fillWidth}
      />
    );
  },
);

export default StreamPresentationPreview;
