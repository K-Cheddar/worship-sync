import { ComponentProps, memo } from "react";
import PresentationPreview from "../../components/Presentation/PresentationPreview";
import { useSelector } from "../../hooks";

type PresentationQuickLinks = ComponentProps<typeof PresentationPreview>["quickLinks"];

type ProjectorPresentationPreviewProps = {
  quickLinks: PresentationQuickLinks;
  isMobile?: boolean;
  previewScale?: number;
  toggleIsTransmitting: () => void;
};

const ProjectorPresentationPreview = memo(
  ({
    quickLinks,
    isMobile,
    previewScale,
    toggleIsTransmitting,
  }: ProjectorPresentationPreviewProps) => {
    const info = useSelector((state) => state.presentation.projectorInfo);
    const prevInfo = useSelector((state) => state.presentation.prevProjectorInfo);
    const isTransmitting = useSelector(
      (state) => state.presentation.isProjectorTransmitting
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
        name="Projector"
        prevInfo={prevInfo}
        timerInfo={timerInfo}
        prevTimerInfo={prevTimerInfo}
        info={info}
        isTransmitting={isTransmitting}
        toggleIsTransmitting={toggleIsTransmitting}
        quickLinks={quickLinks}
        isMobile={isMobile}
        previewScale={previewScale}
      />
    );
  }
);

export default ProjectorPresentationPreview;
