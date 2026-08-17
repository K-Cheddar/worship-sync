import { ComponentProps, memo } from "react";
import { selectOutputSlot } from "../../store/presentationSlice";
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
  toggleIsTransmitting: () => void;
  /** Output this tile shows; defaults to the built-in surface. */
  outputId?: string;
  /** Operator-facing output name; defaults to the surface label. */
  name?: string;
};

const ProjectorPresentationPreview = memo(
  ({
    quickLinks,
    isMobile,
    previewScale,
    fillWidth,
    readOnly = false,
    toggleIsTransmitting,
    outputId = "projector",
    name = "Projector",
  }: ProjectorPresentationPreviewProps) => {
    const slot = useSelector((state) =>
      selectOutputSlot(state, outputId, "projector"),
    );
    const { info, prevInfo, isTransmitting } = slot;
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
      />
    );
  },
);

export default ProjectorPresentationPreview;
