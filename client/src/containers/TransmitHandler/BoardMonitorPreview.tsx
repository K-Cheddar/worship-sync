import { useCallback } from "react";
import { MonitorUp } from "lucide-react";
import ScaledBoardPreview from "../../boards/ScaledBoardPreview";
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
  // machine). Otherwise preview the board this operator would put up. Gated on
  // isOpen so a collapsed panel opens no board connection.
  const previewAliasId = !isOpen
    ? ""
    : isShowingOnMonitor
      ? monitorBoardAliasId
      : aliasId;

  const handleToggle = useCallback(
    (next: boolean) => {
      dispatch(setMonitorBoardAliasId(next ? aliasId : ""));
    },
    [dispatch, aliasId]
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end pt-1.5">
        <Toggle
          label="Show on Monitor"
          labelClassName="text-xs"
          icon={MonitorUp}
          value={isShowingOnMonitor}
          onChange={handleToggle}
          color="#22c55e"
          disabled={!aliasId}
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
