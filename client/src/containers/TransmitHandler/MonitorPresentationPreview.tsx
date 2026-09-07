import { ComponentProps, memo } from "react";
import PresentationPreview from "../../components/Presentation/PresentationPreview";
import ScaledBoardPreview from "../../boards/ScaledBoardPreview";
import { useSelector } from "../../hooks";
import { selectOutputSlot } from "../../store/presentationSlice";

type PresentationQuickLinks = ComponentProps<
  typeof PresentationPreview
>["quickLinks"];

type MonitorPresentationPreviewProps = {
  quickLinks: PresentationQuickLinks;
  isMobile?: boolean;
  previewScale?: number;
  fillWidth?: boolean;
  readOnly?: boolean;
  toggleIsTransmitting: () => void;
};

const MonitorPresentationPreview = memo(
  ({
    quickLinks,
    isMobile,
    previewScale,
    fillWidth,
    readOnly = false,
    toggleIsTransmitting,
  }: MonitorPresentationPreviewProps) => {
    const info = useSelector(
      (state) => selectOutputSlot(state, "monitor", "monitor").info,
    );
    const prevInfo = useSelector(
      (state) => selectOutputSlot(state, "monitor", "monitor").prevInfo,
    );
    const isTransmitting = useSelector(
      (state) => selectOutputSlot(state, "monitor", "monitor").isTransmitting,
    );
    const timers = useSelector((state) => state.timers.timers);
    const timerInfo = useSelector((state) =>
      state.timers.timers.find((timer) => timer.id === info.timerId),
    );
    const prevTimerInfo = useSelector((state) =>
      state.timers.timers.find((timer) => timer.id === prevInfo.timerId),
    );
    // When the monitor is swapped to a discussion board, the preview should show
    // the board too so it matches what's actually on the monitor.
    const monitorBoardAliasId = useSelector(
      (state) => selectOutputSlot(state, "monitor", "monitor").boardAliasId,
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
        hideQuickLinks={readOnly}
        minimalHeader={readOnly}
        isMobile={isMobile}
        showMonitorClockTimer
        previewScale={previewScale}
        fillWidth={fillWidth}
        previewOverride={
          monitorBoardAliasId ? (
            <ScaledBoardPreview aliasId={monitorBoardAliasId} />
          ) : undefined
        }
      />
    );
  },
);

export default MonitorPresentationPreview;
