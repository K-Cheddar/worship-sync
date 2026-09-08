import { shallowEqual } from "react-redux";
import Toggle from "../../components/Toggle/Toggle";
import DisplayOutputsPanel from "../../containers/TransmitHandler/DisplayOutputsPanel";
import { useDispatch, useSelector } from "../../hooks";
import { setOverlayTargetOutputIds } from "../../store/preferencesSlice";
import { selectDisplayOutputs } from "../../store/displayOutputsSlice";
import { selectOutputSlots } from "../../store/presentationSlice";
import { isPushOutputType } from "../../utils/displayOutputs";

/** Stable empty list: a fresh array would re-render every subscriber. */
const EMPTY_TARGETS: string[] = [];

/**
 * Displays tab for the overlay controller.
 *
 * Two things, in the order an operator needs them: which displays overlays and
 * board posts go to, then the church-wide display configuration itself — the
 * same panel the presentation controller shows, editing the same registry, so
 * the two controllers can never disagree about what displays exist.
 */
const OverlayDisplaysPanel = () => {
  const dispatch = useDispatch();
  const outputs = useSelector(selectDisplayOutputs);
  const slots = useSelector(selectOutputSlots);
  const selected = useSelector(
    (state) =>
      state.undoable?.present?.preferences?.preferences
        ?.overlayTargetOutputIds ?? EMPTY_TARGETS,
    shallowEqual,
  );

  // Any push display can be a target: the overlay controller is expected to
  // send to a projector eventually, and the reducers already accept any id.
  const targetable = outputs.filter(
    (output) => output.enabled && isPushOutputType(output.type),
  );

  const toggleTarget = (outputId: string, checked: boolean) => {
    // An empty list means "every live stream", which is how overlays behaved
    // before this choice existed. Unchecking the last display therefore has to
    // record an explicit selection rather than fall back to everything, so the
    // operator's "none of them" is not read as "all of them".
    const next = checked
      ? [...selected, outputId]
      : selected.filter((id) => id !== outputId);
    dispatch(setOverlayTargetOutputIds(next));
  };

  const isFollowingLiveStreams = selected.length === 0;

  return (
    <div className="scrollbar-variable flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3">
      <section className="mx-auto w-full max-w-xl rounded-md border border-white/12 bg-black/20 p-3">
        <h2 className="text-sm font-semibold text-white">Send overlays to</h2>
        <p className="mt-1 text-xs text-gray-300">
          {isFollowingLiveStreams
            ? "Every stream that is live. Pick displays below to send to named ones instead."
            : "Only the displays picked here, and only while they are live."}
        </p>

        <ul className="mt-2 flex flex-col gap-2">
          {targetable.map((output) => {
            const isLive = Boolean(slots[output.id]?.isTransmitting);
            return (
              <li
                key={output.id}
                className="flex items-center justify-between gap-2 rounded border border-white/10 bg-black/20 px-2 py-2"
              >
                <Toggle
                  label={output.name}
                  labelClassName="text-xs"
                  value={selected.includes(output.id)}
                  onChange={(value) => toggleTarget(output.id, value)}
                />
                <span className="shrink-0 text-[10px] text-gray-400">
                  {isLive ? "Live" : "Not live"}
                </span>
              </li>
            );
          })}
        </ul>

        {targetable.length === 0 && (
          <p className="mt-2 text-xs text-gray-400">
            No displays are enabled yet. Add one below.
          </p>
        )}
      </section>

      <DisplayOutputsPanel />
    </div>
  );
};

export default OverlayDisplaysPanel;
