import { useMemo } from "react";
import { Link2 } from "lucide-react";
import { useSelector } from "../../hooks";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import { selectFollowerOutputIds } from "../../store/presentationSlice";
import type { RootState } from "../../store/store";

/**
 * "Another screen is showing this one."
 *
 * Without it, the operator driving the sanctuary has no way to know a second
 * audience is watching their output — they would keep working as if one room
 * were in front of them and be right about it only half the time.
 */
const MirroredByBadge = ({ outputId }: { outputId: string }) => {
  const followerIds = useSelector((state: RootState) =>
    selectFollowerOutputIds(state, outputId),
  );
  const outputs = useSelector(selectDisplayOutputs);

  const names = useMemo(
    () =>
      followerIds
        .map(
          (id) => outputs.find((output) => output.id === id)?.name ?? id,
        )
        .sort((a, b) => a.localeCompare(b)),
    [followerIds, outputs],
  );

  if (names.length === 0) return null;

  return (
    <p className="flex items-center gap-1 text-xs font-medium text-cyan-300">
      <Link2 size={13} aria-hidden />
      <span className="truncate">
        Mirrored by {names.join(", ")}
      </span>
    </p>
  );
};

export default MirroredByBadge;
