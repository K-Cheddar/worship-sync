import { useCallback, useMemo, useState } from "react";
import { MonitorUp } from "lucide-react";
import BoardPresentationFontScaleControl from "../../boards/BoardPresentationFontScaleControl";
import ScaledBoardPreview from "../../boards/ScaledBoardPreview";
import { setStoredBoardDisplayAliasId } from "../../boards/boardUtils";
import { useBoardPresentationFontScale } from "../../boards/useBoardPresentationFontScale";
import Toggle from "../../components/Toggle/Toggle";
import Select from "../../components/Select/Select";
import { useDispatch, useSelector } from "../../hooks";
import {
  setDisplayBoardAliasId,
  selectOutputSlots,
} from "../../store/presentationSlice";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import { supportsBoardTakeover } from "../../utils/displayOutputs";
import { cn } from "../../utils/cnHelper";

type BoardMonitorPreviewProps = {
  /**
   * The discussion board this tile targets, resolved by the parent (this device's
   * remembered board if any, otherwise the church's first board). May be empty
   * only when the church has no board at all.
   */
  aliasId: string;
  /**
   * Whether the collapsible section is expanded. The parent keeps this component
   * mounted while collapsed (for the height animation), so we gate the live board
   * preview on this: while collapsed the preview gets an empty alias and opens no
   * board connection — only an expanded panel polls the board API.
   */
  isOpen: boolean;
  isMobile?: boolean;
  /** DisplayWindow width multiplier (1 = default 14vw / 32vw mobile). */
  previewScale?: number;
  /** Fill parent width with a true 16:9 stage instead of a vw-based size. */
  fillWidth?: boolean;
};

/**
 * Right-panel tile that previews the discussion board exactly as it appears on the
 * board display, with a toggle to swap the stage monitor between presentation
 * content and the board.
 */
const BoardMonitorPreview = ({
  aliasId,
  isOpen,
  isMobile = false,
  previewScale = 1,
  fillWidth = false,
}: BoardMonitorPreviewProps) => {
  const dispatch = useDispatch();
  // Any full-frame display can host the board, so the operator picks which one.
  const displayOutputs = useSelector(selectDisplayOutputs);
  const boardCapableOutputs = useMemo(
    () =>
      displayOutputs.filter(
        (output) => output.enabled && supportsBoardTakeover(output.type),
      ),
    [displayOutputs],
  );
  const outputSlots = useSelector(selectOutputSlots);
  // The display already showing a board wins, so the control always describes
  // what is actually up rather than what this operator last picked.
  const liveBoardOutputId = useMemo(
    () =>
      boardCapableOutputs.find(
        (output) => (outputSlots[output.id]?.boardAliasId ?? "") !== "",
      )?.id ?? "",
    [boardCapableOutputs, outputSlots],
  );
  const [pickedOutputId, setPickedOutputId] = useState("");
  const targetOutputId =
    liveBoardOutputId ||
    (boardCapableOutputs.some((output) => output.id === pickedOutputId)
      ? pickedOutputId
      : (boardCapableOutputs.find((output) => output.id === "monitor")?.id ??
        boardCapableOutputs[0]?.id ??
        ""));
  const monitorBoardAliasId = targetOutputId
    ? (outputSlots[targetOutputId]?.boardAliasId ?? "")
    : "";
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
    { enabled: isOpen },
  );

  const handleToggle = useCallback(
    (next: boolean) => {
      // Turning the board on is an explicit open, so remember it for this device
      // (mirrors seeding when opening the board window) — the resolver only offers
      // a default and never writes storage itself.
      if (next && aliasId) {
        setStoredBoardDisplayAliasId(aliasId);
      }
      dispatch(
        setDisplayBoardAliasId({
          aliasId: next ? aliasId : "",
          outputIds: targetOutputId ? [targetOutputId] : undefined,
        }),
      );
    },
    [dispatch, aliasId, targetOutputId],
  );

  // Match PresentationPreview so the board tile is the same footprint as
  // projector/monitor/stream previews in this panel.
  const previewWidthVw = (isMobile ? 32 : 14) * previewScale;

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div
        className={cn(
          "flex gap-2",
          fillWidth ? "w-full flex-col" : "items-start",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 flex-col",
            fillWidth ? "w-full" : "shrink-0",
          )}
          style={
            fillWidth
              ? { width: "100%" }
              : { width: `${previewWidthVw}vw`, maxWidth: "100%" }
          }
          data-testid="board-monitor-preview-stage"
        >
          <ScaledBoardPreview
            aliasId={previewAliasId}
            missingAliasTitle="No discussion board selected."
            missingAliasDescription="Pick a board in moderation to preview it here."
          />
        </div>
        <div
          className={cn(
            "@container flex min-w-0 flex-col items-center justify-center gap-2 py-1",
            fillWidth ? "w-full flex-row flex-wrap" : "flex-1",
          )}
        >
          {boardCapableOutputs.length > 1 && (
            <Select
              className="w-full max-w-40"
              label="Display"
              hideLabel
              value={targetOutputId}
              options={boardCapableOutputs.map((output) => ({
                value: output.id,
                label: output.name,
              }))}
              // Locked while a board is up: moving it would need to clear the
              // old display and set the new one, and a half-applied swap during
              // a service leaves the board on a screen nobody chose.
              disabled={isShowingOnMonitor}
              onChange={(value) => setPickedOutputId(value)}
            />
          )}
          <Toggle
            label={
              boardCapableOutputs.length > 1
                ? `On ${boardCapableOutputs.find((o) => o.id === targetOutputId)?.name ?? "display"}`
                : "On monitor"
            }
            labelClassName="min-w-0 shrink truncate text-xs"
            className="min-w-0 max-w-full shrink items-center"
            icon={MonitorUp}
            value={isShowingOnMonitor}
            onChange={handleToggle}
            color="#22c55e"
            // Turning a board ON needs a local alias to put up, but a board that's
            // already live must always be switchable OFF — otherwise a cleared
            // alias would strand it on the monitor with no way to remove it.
            disabled={!aliasId && !isShowingOnMonitor}
          />
          <BoardPresentationFontScaleControl
            size="mini"
            className="w-fit"
            value={fontScale}
            onChange={changeFontScale}
            disabled={!targetAliasId}
          />
        </div>
      </div>
    </div>
  );
};

export default BoardMonitorPreview;
