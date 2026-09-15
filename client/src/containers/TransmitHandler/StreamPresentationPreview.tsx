import { ComponentProps, memo, type ReactNode } from "react";
import {
  selectOutputSlot,
  selectResolvedOutputSlot,
} from "../../store/presentationSlice";
import PresentationPreview from "../../components/Presentation/PresentationPreview";
import { useSelector } from "../../hooks";

type PresentationQuickLinks = ComponentProps<
  typeof PresentationPreview
>["quickLinks"];

type StreamPresentationPreviewProps = {
  quickLinks: PresentationQuickLinks;
  isMobile?: boolean;
  previewScale?: number;
  fillWidth?: boolean;
  readOnly?: boolean;
  isVisible?: boolean;
  toggleIsTransmitting: () => void;
  /** Output this tile shows; defaults to the built-in surface. */
  outputId?: string;
  /** Operator-facing output name; defaults to the surface label. */
  name?: string;
  variant: "default" | "overlayStreamFocus";
  showFocusedStreamControls: boolean;
  /** Mirror / follower chrome for this display, shown inside the card. */
  footer?: ReactNode;
};

const StreamPresentationPreview = memo(
  ({
    quickLinks,
    isMobile,
    previewScale,
    fillWidth,
    readOnly = false,
    isVisible = true,
    toggleIsTransmitting,
    variant,
    showFocusedStreamControls,
    outputId = "stream",
    name = "Stream",
    footer,
  }: StreamPresentationPreviewProps) => {
    const info = useSelector(
      (state) => selectResolvedOutputSlot(state, outputId, "stream").info,
    );
    const prevInfo = useSelector(
      (state) => selectResolvedOutputSlot(state, outputId, "stream").prevInfo,
    );
    const isTransmitting = useSelector(
      (state) => selectOutputSlot(state, outputId, "stream").isTransmitting,
    );
    const streamItemContentBlocked = useSelector(
      (state) => selectOutputSlot(state, outputId, "stream").itemContentBlocked,
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
        name={name}
        outputId={outputId}
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
        footer={footer}
        isVisible={isVisible}
      />
    );
  },
);

export default StreamPresentationPreview;
