/**
 * Which displays an item sends to.
 *
 * `shouldSendTo` keeps its per-surface booleans — they are persisted on every
 * item and gate whether a surface participates at all. `outputIds` narrows that
 * to named displays, which is what lets one item go to Main while another goes
 * to Lobby.
 *
 * An empty or absent `outputIds` means the built-in display of each enabled
 * surface — never every display of that kind. Displays of the same kind exist so
 * they can differ, so a new display stays silent until an operator picks it,
 * while items saved before this keep going exactly where they used to.
 */
import { ShouldSendTo } from "../types";
import { DisplayOutput, PushOutputType } from "./displayOutputs";

/** Output ids to target for a surface type. Empty only when nothing matches. */
export const getSendTargetIdsForType = (
  shouldSendTo: ShouldSendTo,
  outputs: DisplayOutput[],
  type: PushOutputType,
): string[] => {
  const selectable = outputs.filter(
    (output) => output.enabled && output.type === type,
  );
  const selected = shouldSendTo.outputIds;
  // No selection: the built-in display for this surface, which is what the
  // reducers also fall back to.
  if (!selected || selected.length === 0) {
    return selectable.some((output) => output.id === type) ? [type] : [];
  }
  return selectable
    .filter((output) => selected.includes(output.id))
    .map((output) => output.id);
};

/**
 * Does this item send to the surface at all?
 *
 * The surface toggle must be on, and — once displays are named — at least one
 * selected display must belong to that surface.
 */
export const shouldSendToType = (
  shouldSendTo: ShouldSendTo,
  outputs: DisplayOutput[],
  type: PushOutputType,
): boolean => {
  if (!shouldSendTo[type]) return false;
  return getSendTargetIdsForType(shouldSendTo, outputs, type).length > 0;
};

/** Toggle one display in the selection, keeping the surface flags in step. */
export const toggleSendTarget = (
  shouldSendTo: ShouldSendTo,
  outputs: DisplayOutput[],
  outputId: string,
): Partial<ShouldSendTo> => {
  // Start from what the UI shows as selected, not from an empty list: the
  // default view marks displays on, so toggling one must remove only that one.
  const current = getSelectedSendTargetIds(shouldSendTo, outputs);
  const isSelected = current.includes(outputId);
  const outputIds = isSelected
    ? current.filter((id) => id !== outputId)
    : [...current, outputId];

  // Surface flags follow the selection so the existing send path and any older
  // client reading only the booleans still behave sensibly.
  //
  // An empty selection means "send nowhere", not "back to defaults": every flag
  // goes off, otherwise the empty list would read as unconfigured and the UI
  // would immediately reselect the built-ins the operator just turned off.
  const flagsFor = (type: PushOutputType) =>
    outputIds.length === 0
      ? false
      : outputs.some(
          (output) => output.type === type && outputIds.includes(output.id),
        );

  return {
    outputIds,
    projector: flagsFor("projector"),
    monitor: flagsFor("monitor"),
    stream: flagsFor("stream"),
  };
};

/** Displays currently selected, defaulting to every enabled display. */
export const getSelectedSendTargetIds = (
  shouldSendTo: ShouldSendTo,
  outputs: DisplayOutput[],
): string[] => {
  const selected = shouldSendTo.outputIds;
  if (selected && selected.length > 0) {
    return outputs
      .filter((output) => output.enabled && selected.includes(output.id))
      .map((output) => output.id);
  }
  // Must match what actually receives content, or the first toggle would look
  // like it deselected one screen while really dropping all the others.
  return (["projector", "monitor", "stream"] as PushOutputType[])
    .filter((type) => shouldSendTo[type])
    .filter((type) =>
      outputs.some((output) => output.id === type && output.enabled),
    );
};
