import { ComponentProps, memo } from "react";
import { selectOutputSlot } from "../../store/presentationSlice";
import PresentationPreview from "../../components/Presentation/PresentationPreview";
import ScaledBoardPreview from "../../boards/ScaledBoardPreview";
import { useSelector } from "../../hooks";

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
  /** Output this tile shows; defaults to the built-in surface. */
  outputId?: string;
  /** Operator-facing output name; defaults to the surface label. */
  name?: string;
};

const MonitorPresentationPreview = memo(
  ({
    quickLinks,
    isMobile,
    previewScale,
    fillWidth,
    readOnly = false,
    toggleIsTransmitting,
    outputId = "monitor",
    name = "Monitor",
  }: MonitorPresentationPreviewProps) => {
    const info = useSelector(
      (state) => selectOutputSlot(state, outputId, "monitor").info,
    );
    const prevInfo = useSelector(
      (state) => selectOutputSlot(state, outputId, "monitor").prevInfo,
    );
    const isTransmitting = useSelector(
      (state) => selectOutputSlot(state, outputId, "monitor").isTransmitting,
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
      (state) => selectOutputSlot(state, outputId, "monitor").boardAliasId,
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
