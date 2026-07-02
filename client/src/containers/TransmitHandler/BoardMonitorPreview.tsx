import { useCallback } from "react";
import { MonitorUp } from "lucide-react";
import BoardPresentationFontScaleControl from "../../boards/BoardPresentationFontScaleControl";
import ScaledBoardPreview from "../../boards/ScaledBoardPreview";
import { useBoardPresentationFontScale } from "../../boards/useBoardPresentationFontScale";
import { useStoredBoardDisplayAlias } from "../../boards/useStoredBoardDisplayAlias";
import Toggle from "../../components/Toggle/Toggle";
import { useDispatch, useSelector } from "../../hooks";
import { setMonitorBoardAliasId } from "../../store/presentationSlice";

type BoardMonitorPreviewProps = {
  /**
   * Whether the collapsible section is expanded. The parent keeps this component
   * mounted while collapsed (for the height animation), so we gate the live board
   * preview on this: while collapsed the preview gets an empty alias and opens no
   * board connection — only an expanded panel polls the board API.
   */
  isOpen: boolean;
};

/**
 * Right-panel tile that previews the discussion board exactly as it appears on the
 * board display, with a toggle to swap the stage monitor between presentation
 * content and the board.
 */
const BoardMonitorPreview = ({ isOpen }: BoardMonitorPreviewProps) => {
  const dispatch = useDispatch();
  const aliasId = useStoredBoardDisplayAlias();
  const monitorBoardAliasId = useSelector(
    (state) => state.presentation.monitorBoardAliasId
  );
  const isShowingOnMonitor = monitorBoardAliasId !== "";

  // While a board is live on the monitor, mirror exactly that board so the preview
  // can never disagree with the monitor (e.g. a different board synced from another
  // machine). Otherwise preview the board this operator would put up.
  const targetAliasId = isShowingOnMonitor ? monitorBoardAliasId : aliasId;
  // Gated on isOpen so a collapsed panel opens no board connection.
  const previewAliasId = isOpen ? targetAliasId : "";

  // Adjust the text size of whichever board this tile targets — the live board
  // when one is up, otherwise the board about to go up — so operators can size it
  // here instead of opening the board controller. Idle while collapsed.
  const { fontScale, changeFontScale } = useBoardPresentationFontScale(
    targetAliasId,
    { enabled: isOpen }
  );

  const handleToggle = useCallback(
    (next: boolean) => {
      dispatch(setMonitorBoardAliasId(next ? aliasId : ""));
    },
    [dispatch, aliasId]
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-1.5">
        <BoardPresentationFontScaleControl
          size="compact"
          value={fontScale}
          onChange={changeFontScale}
          disabled={!targetAliasId}
        />
        <Toggle
          label="Show on Monitor"
          labelClassName="text-xs"
          icon={MonitorUp}
          value={isShowingOnMonitor}
          onChange={handleToggle}
          color="#22c55e"
          // Turning a board ON needs a local alias to put up, but a board that's
          // already live must always be switchable OFF — otherwise a cleared
          // alias would strand it on the monitor with no way to remove it.
          disabled={!aliasId && !isShowingOnMonitor}
        />
      </div>
      <ScaledBoardPreview
        aliasId={previewAliasId}
        missingAliasTitle="No discussion board selected."
        missingAliasDescription="Pick a board in moderation to preview it here."
      />
    </div>
  );
};

export default BoardMonitorPreview;
