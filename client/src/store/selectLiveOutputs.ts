import { PushOutputType } from "../utils/displayOutputs";
import { selectDisplayOutputs } from "./displayOutputsSlice";
import { selectOutputSlots } from "./presentationSlice";

type LiveOutputsState = Parameters<typeof selectDisplayOutputs>[0] &
  Parameters<typeof selectOutputSlots>[0];

/**
 * Displays of a render profile this controller should send to: configured in
 * the registry and currently live.
 *
 * Enablement and targeting have to come from the same list. When one asked
 * "is any stream live" and the other picked "the first enabled stream", Send
 * lit up while the click reached a slot the reducers then skipped — the
 * operator saw a working button that did nothing.
 *
 * Returns a fresh array, so subscribe with `shallowEqual`.
 */
export const selectLiveOutputIdsOfType = (
  state: LiveOutputsState,
  type: PushOutputType,
): string[] => {
  const slots = selectOutputSlots(state);
  return selectDisplayOutputs(state)
    .filter(
      (output) =>
        output.enabled &&
        output.type === type &&
        slots[output.id]?.isTransmitting,
    )
    .map((output) => output.id);
};

type OverlayTargetsState = LiveOutputsState & {
  undoable?: {
    present?: {
      preferences?: { preferences?: { overlayTargetOutputIds?: string[] } };
    };
  };
};

/**
 * Displays the overlay controller sends to right now.
 *
 * The operator's chosen displays, narrowed to the ones that are live — a
 * selected display that is off air would silently swallow the send, because the
 * reducers skip slots that are not transmitting. With nothing chosen this is
 * every live stream, which is how overlays behaved before the choice existed.
 *
 * Not restricted to streams: the selection can name any push display, so an
 * overlay sent to a projector works the day that surface renders one.
 *
 * Returns a fresh array, so subscribe with `shallowEqual`.
 */
export const selectOverlayTargetIds = (state: OverlayTargetsState): string[] => {
  const chosen =
    state?.undoable?.present?.preferences?.preferences
      ?.overlayTargetOutputIds ?? [];
  if (chosen.length === 0) return selectLiveOutputIdsOfType(state, "stream");

  const slots = selectOutputSlots(state);
  return selectDisplayOutputs(state)
    .filter(
      (output) =>
        output.enabled &&
        chosen.includes(output.id) &&
        slots[output.id]?.isTransmitting,
    )
    .map((output) => output.id);
};
