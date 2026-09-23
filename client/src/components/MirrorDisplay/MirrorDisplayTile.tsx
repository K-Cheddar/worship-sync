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
  const followingSource = outputs.find((output) => output.id === followingId);
  const followingSourceAvailable = sources.some(
    (source) => source.id === followingId,
  );

  if (sources.length === 0 && !followingId) return null;

  return (
    <div className={cn("flex min-h-10 w-full flex-wrap items-center gap-2", className)}>
      {followingId && (
        <div
          className={cn(
            "w-full text-xs",
            followingSourceAvailable ? "text-gray-300" : "text-amber-300",
          )}
          data-testid={`mirror-status-${outputId}`}
        >
          {followingSourceAvailable && followingSource ? (
            `Mirroring ${followingSource.name}`
          ) : (
            <>
              <p>Mirror source unavailable</p>
              <p>{followingSource?.name ?? followingId}</p>
            </>
          )}
        </div>
      )}
      {sources.map((source) => (
        <Button
          key={source.id}
          svg={followingId === source.id ? Link2Off : Link2}
          variant={followingId === source.id ? "secondary" : "tertiary"}
          className="min-w-0 flex-1 justify-center text-sm"
          aria-pressed={followingId === source.id}
          onClick={() =>
            dispatch(
              setOutputFollowing({
                outputId,
                followingOutputId: followingId === source.id ? "" : source.id,
              }),
            )
          }
        >
          {followingId === source.id ? "Stop mirroring" : `Mirror ${source.name}`}
        </Button>
      ))}
      {followingId && !followingSourceAvailable && (
        <Button
          svg={Link2Off}
          variant="secondary"
          className="min-w-0 flex-1 justify-center text-sm"
          onClick={() =>
            dispatch(
              setOutputFollowing({ outputId, followingOutputId: "" }),
            )
          }
        >
          Stop mirroring
        </Button>
      )}
    </div>
  );
};

export default MirrorDisplayTile;
