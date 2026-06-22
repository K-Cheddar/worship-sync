import BoardPresentationScreen from "../../boards/BoardPresentationScreen";
import DisplayClock from "./DisplayClock";
import DisplayTimer from "./DisplayTimer";
import { useSelector } from "../../hooks";
import { MONITOR_BAND_CLOCK_TIMER_PX } from "../../constants";

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
}: MonitorBoardViewProps) => {
  const { showClock, showTimer, clockFontSize, timerFontSize } = useSelector(
    (state) => state.undoable.present.preferences.monitorSettings
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
            {showTimer && <DisplayTimer fontSize={timerFontSize * scale} />}
          </div>
        </div>
      )}
    </div>
  );
};

export default MonitorBoardView;
