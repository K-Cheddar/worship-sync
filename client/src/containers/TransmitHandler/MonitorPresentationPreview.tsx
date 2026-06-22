import { ComponentProps, memo } from "react";
import PresentationPreview from "../../components/Presentation/PresentationPreview";
import ScaledBoardPreview from "../../boards/ScaledBoardPreview";
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
    // When the monitor is swapped to a discussion board, the preview should show
    // the board too so it matches what's actually on the monitor.
    const monitorBoardAliasId = useSelector(
      (state) => state.presentation.monitorBoardAliasId
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
        previewOverride={
          monitorBoardAliasId ? (
            <ScaledBoardPreview aliasId={monitorBoardAliasId} />
          ) : undefined
        }
      />
    );
  }
);

export default MonitorPresentationPreview;
