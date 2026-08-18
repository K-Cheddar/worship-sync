import { useMemo } from "react";
import cn from "classnames";
import { Link2, Link2Off } from "lucide-react";
import Button from "../Button/Button";
import { useDispatch, useSelector } from "../../hooks";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import {
  selectOutputFollowing,
  setOutputFollowing,
} from "../../store/presentationSlice";
import type { RootState } from "../../store/store";

type MirrorDisplayTileProps = {
  /** The display this controller drives. */
  outputId: string;
  /** Displays it may mirror; normally every other projector of the same kind. */
  sourceOutputIds: string[];
  className?: string;
};

/**
 * Put this controller's display on another display's content, and take it back.
 *
 * Pinned rather than buried in a menu: joining the main screen for a sermon and
 * leaving it again are live gestures made under time pressure, and the operator
 * has to be able to see at a glance which of the two states they are in.
 *
 * Mirroring does not send anything. It points this display at another one, so
 * whatever the operator stages here keeps arriving unseen and is on screen the
 * instant they stop.
 */
const MirrorDisplayTile = ({
  outputId,
  sourceOutputIds,
  className,
}: MirrorDisplayTileProps) => {
  const dispatch = useDispatch();
  const outputs = useSelector(selectDisplayOutputs);
  const followingId = useSelector((state: RootState) =>
    selectOutputFollowing(state, outputId),
  );

  const sources = useMemo(
    () =>
      outputs.filter(
        (output) => output.enabled && sourceOutputIds.includes(output.id),
      ),
    [outputs, sourceOutputIds],
  );

  const followingName = useMemo(
    () => outputs.find((output) => output.id === followingId)?.name,
    [outputs, followingId],
  );

  if (sources.length === 0) return null;

  const stop = () =>
    dispatch(setOutputFollowing({ outputId, followingOutputId: "" }));

  if (followingId) {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-md border-2 border-cyan-400 bg-cyan-950/40 px-3 py-2",
          className,
        )}
      >
        <p className="min-w-0 truncate text-sm font-semibold text-cyan-200">
          Mirroring {followingName ?? followingId}
        </p>
        <Button
          svg={Link2Off}
          variant="secondary"
          className="shrink-0 text-sm"
          onClick={stop}
        >
          Stop mirroring
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {sources.map((source) => (
        <Button
          key={source.id}
          svg={Link2}
          variant="tertiary"
          className="text-sm"
          onClick={() =>
            dispatch(
              setOutputFollowing({
                outputId,
                followingOutputId: source.id,
              }),
            )
          }
        >
          Mirror {source.name}
        </Button>
      ))}
    </div>
  );
};

export default MirrorDisplayTile;
