import { useMemo } from "react";
import Toggle from "../Toggle/Toggle";
import { useDispatch, useSelector } from "../../hooks";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import { setShouldSendTo } from "../../store/itemSlice";
import { isPushOutputType } from "../../utils/displayOutputs";
import {
  getSelectedSendTargetIds,
  toggleSendTarget,
} from "../../utils/sendTargets";
import { ShouldSendTo } from "../../types";
import { useActiveControllerProfile } from "../../context/activeController";
import { getControllerOutputs } from "../../utils/controllerProfiles";
import cn from "classnames";

type SendTargetsProps = {
  shouldSendTo: ShouldSendTo;
  /** Local editing (CreateItem) instead of the item in the store. */
  onChange?: (patch: Partial<ShouldSendTo>) => void;
  className?: string;
  layout?: "row" | "wrap";
};

/**
 * Which displays this item sends to, chosen by name.
 *
 * Displays of the same kind do not mirror, so a second projector receives
 * content only when it is selected here. That is the whole point of having more
 * than one: Main can carry the song while Lobby carries announcements.
 *
 * On a scoped controller only that controller's displays are listed, and only
 * they can be changed — the item's targets on other controllers are preserved
 * untouched, since the same library item can sit in more than one outline.
 */
const SendTargets = ({
  shouldSendTo,
  onChange,
  className,
  layout = "row",
}: SendTargetsProps) => {
  const dispatch = useDispatch();
  const outputs = useSelector(selectDisplayOutputs);
  const profile = useActiveControllerProfile();

  // Every push display, not just this controller's: resolution needs the full
  // registry to keep out-of-scope selections and surface flags correct.
  const sendableOutputs = useMemo(
    () =>
      outputs.filter(
        (output) => output.enabled && isPushOutputType(output.type),
      ),
    [outputs],
  );

  /** The rows this operator may actually change. */
  const visibleOutputs = useMemo(
    () => getControllerOutputs(profile, sendableOutputs),
    [profile, sendableOutputs],
  );

  const selectedIds = useMemo(
    () =>
      getSelectedSendTargetIds(shouldSendTo, sendableOutputs, profile),
    [shouldSendTo, sendableOutputs, profile],
  );

  const handleToggle = (outputId: string) => {
    const patch = toggleSendTarget(
      shouldSendTo,
      sendableOutputs,
      outputId,
      profile,
    );
    if (onChange) onChange(patch);
    else dispatch(setShouldSendTo(patch));
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1",
        layout === "wrap" && "flex-wrap justify-center gap-x-4 gap-y-2",
        className,
      )}
    >
      {visibleOutputs.map((output, index) => (
        <div key={output.id} className="flex items-center">
          {layout === "row" && index > 0 && (
            <hr className="border-gray-300 border-r h-3/4 mx-2" />
          )}
          <Toggle
            label={output.name}
            value={selectedIds.includes(output.id)}
            onChange={() => handleToggle(output.id)}
          />
        </div>
      ))}
    </div>
  );
};

export default SendTargets;
