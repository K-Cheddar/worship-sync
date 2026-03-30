import { ComponentProps, memo } from "react";
import PresentationPreview from "../../components/Presentation/PresentationPreview";
import { useSelector } from "../../hooks";

type PresentationQuickLinks = ComponentProps<typeof PresentationPreview>["quickLinks"];

type MonitorPresentationPreviewProps = {
  quickLinks: PresentationQuickLinks;
  isMobile?: boolean;
  previewScale?: number;
  toggleIsTransmitting: () => void;
};

const MonitorPresentationPreview = memo(
  ({
    quickLinks,
    isMobile,
    previewScale,
    toggleIsTransmitting,
  }: MonitorPresentationPreviewProps) => {
    const info = useSelector((state) => state.presentation.monitorInfo);
    const prevInfo = useSelector((state) => state.presentation.prevMonitorInfo);
    const isTransmitting = useSelector(
      (state) => state.presentation.isMonitorTransmitting
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
        name="Monitor"
        prevInfo={prevInfo}
        timerInfo={timerInfo}
        prevTimerInfo={prevTimerInfo}
        info={info}
        isTransmitting={isTransmitting}
        toggleIsTransmitting={toggleIsTransmitting}
        quickLinks={quickLinks}
        isMobile={isMobile}
        showMonitorClockTimer
        previewScale={previewScale}
      />
    );
  }
);

export default MonitorPresentationPreview;
