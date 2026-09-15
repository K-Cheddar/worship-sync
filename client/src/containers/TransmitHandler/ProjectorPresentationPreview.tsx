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

type ProjectorPresentationPreviewProps = {
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
  /** Mirror / follower chrome for this display, shown inside the card. */
  footer?: ReactNode;
};

const ProjectorPresentationPreview = memo(
  ({
    quickLinks,
    isMobile,
    previewScale,
    fillWidth,
    readOnly = false,
    isVisible = true,
    toggleIsTransmitting,
    outputId = "projector",
    name = "Projector",
    footer,
  }: ProjectorPresentationPreviewProps) => {
    // Content follows the mirror so the preview shows what is on the screen,
    // not what this display would show if it stopped mirroring. Live state stays
    // this display's own.
    const { info, prevInfo } = useSelector((state) =>
      selectResolvedOutputSlot(state, outputId, "projector"),
    );
    const isTransmitting = useSelector(
      (state) => selectOutputSlot(state, outputId, "projector").isTransmitting,
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
        quickLinks={quickLinks}
        hideQuickLinks={readOnly}
        minimalHeader={readOnly}
        isMobile={isMobile}
        showClockTimer
        previewScale={previewScale}
        fillWidth={fillWidth}
        footer={footer}
        isVisible={isVisible}
      />
    );
  },
);

export default ProjectorPresentationPreview;
