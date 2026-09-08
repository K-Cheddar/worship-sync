import BoardPresentationScreen from "../../boards/BoardPresentationScreen";
import DisplayClock from "./DisplayClock";
import DisplayTimer from "./DisplayTimer";
import { useSelector } from "../../hooks";
import { MONITOR_BAND_CLOCK_TIMER_PX } from "../../constants";
import { useContext, useMemo } from "react";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import {
  resolveDisplaySettings,
  resolveOutputDefaults,
} from "../../utils/displaySettings";
import { useScreenOverrides } from "../../hooks/useScreenOverrides";
import { GlobalInfoContext } from "../../context/globalInfo";

type MonitorBoardViewProps = {
  aliasId: string;
  /**
   * Reference→render-space scale (renderHeight / 1080). The clock/timer band is
   * authored in the 1080p monitor reference; multiplying by this keeps the band
   * proportional whether rendered full-screen on the monitor or shrunk into a
   * preview, so the preview is a true mirror of the page.
   */
  scale: number;
  missingAliasTitle?: string;
  missingAliasDescription?: string;
  /** Display whose band settings apply; defaults to the built-in monitor. */
  outputId?: string;
};

/**
 * The stage monitor's discussion-board view: the board with the clock/timer band
 * composited on top. Shared by the real monitor page and its previews so they
 * stay identical.
 */
const MonitorBoardView = ({
  aliasId,
  scale,
  missingAliasTitle,
  missingAliasDescription,
  outputId = "monitor",
}: MonitorBoardViewProps) => {
  const registryOutputs = useSelector(selectDisplayOutputs);
  // Same override source as the normal layout, so one physical screen cannot
  // disagree with itself between presentation and board mode.
  const pairedDeviceSettings = useContext(GlobalInfoContext)?.device?.settings;
  // Same fallback as every other surface: the built-in monitor keeps honouring
  // the church-wide settings until it is configured as a display.
  const legacyMonitorSettings = useSelector((state) =>
    outputId === "monitor"
      ? state.undoable?.present?.preferences?.monitorSettings
      : undefined,
  );
  // Subscribed like every other live surface, so a setting changed on the
  // controller reaches this board without a reload.
  const screenOverrides = useScreenOverrides(outputId, pairedDeviceSettings);
  const { showClock, showTimer, clockFontSize, timerFontSize } =
    useMemo(
      () =>
        resolveDisplaySettings(
          resolveOutputDefaults(
            registryOutputs.find((output) => output.id === outputId)?.settings,
            legacyMonitorSettings,
          ),
          screenOverrides,
          registryOutputs.find((output) => output.id === outputId)?.type,
        ),
      [legacyMonitorSettings, outputId, screenOverrides, registryOutputs],
    );
  const showBand = showClock || showTimer;

  return (
    <div className="flex h-full w-full flex-col bg-black">
      <div className="relative min-h-0 flex-1">
        <BoardPresentationScreen
          aliasId={aliasId}
          fillParent
          missingAliasTitle={missingAliasTitle}
          missingAliasDescription={missingAliasDescription}
        />
      </div>
      {showBand && (
        <div
          className="flex w-full shrink-0 items-center gap-1 bg-black px-4"
          style={{ height: MONITOR_BAND_CLOCK_TIMER_PX * scale }}
        >
          <div className="flex h-full min-w-0 flex-1 items-center justify-start">
            {showClock && <DisplayClock fontSize={clockFontSize * scale} />}
          </div>
          <div className="flex h-full min-w-0 flex-1 items-center justify-end">
            {showTimer && (
              <DisplayTimer
                fontSize={timerFontSize * scale}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MonitorBoardView;
