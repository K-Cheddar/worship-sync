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
 *
 * ## Controller scoping
 *
 * Every function here takes an optional {@link ControllerProfile}. Passing an
 * **unscoped** profile (or none at all) resolves exactly as it did before
 * controller profiles existed — that equivalence is deliberate and load-bearing,
 * because both built-in controllers ship unscoped and a church that never opens
 * the Controllers panel must not see its sends move.
 *
 * A **scoped** controller resolves in two extra steps:
 *
 * 1. Targets are narrowed to displays the controller owns, so an operator on the
 *    lobby controller cannot reach the sanctuary projector — not as a UI
 *    convention, but as a property of the resolution.
 * 2. If that leaves nothing, the controller's own defaults apply. This is what
 *    makes a shared library item work in two lists at once: a song saved with
 *    the sanctuary's displays, dropped into the lobby outline, lands on the
 *    lobby screen instead of silently going nowhere.
 *
 * The one thing that is never overridden is an operator explicitly clearing
 * every display — see {@link sendsNowhere}. "Send nowhere" has to survive, or
 * the fallback would put content back on screen that someone deliberately took
 * off.
 */
import { ShouldSendTo } from "../types";
import { DisplayOutput, PushOutputType } from "./displayOutputs";
import {
  ControllerProfile,
  getControllerDefaultSendIds,
  getControllerOutputs,
} from "./controllerProfiles";

const PUSH_TYPES: PushOutputType[] = ["projector", "monitor", "stream"];

/**
 * Did the operator explicitly clear every display?
 *
 * `toggleSendTarget` turns all the surface flags off alongside an empty
 * selection precisely so this state is distinguishable from "never configured".
 * Without that distinction the controller-default fallback would resurrect
 * content someone had just taken off screen.
 */
export const sendsNowhere = (shouldSendTo: ShouldSendTo) =>
  (shouldSendTo.outputIds?.length ?? 0) === 0 &&
  !shouldSendTo.projector &&
  !shouldSendTo.monitor &&
  !shouldSendTo.stream;

/**
 * Does this controller substitute its own defaults for the item's targeting?
 *
 * Auxiliary controllers only. The per-surface booleans were designed for the
 * presentation controller's three surfaces and still mean exactly what they say
 * there, so an item set to "projector, not monitor" keeps behaving that way.
 * On an auxiliary controller those same flags describe screens it does not own,
 * which is why a shared library item needs the controller's defaults instead.
 */
const usesControllerDefaults = (
  profile?: ControllerProfile | null,
): profile is ControllerProfile => profile?.type === "aux-presentation";

/**
 * A scoped controller's own defaults for one surface type, or nothing.
 *
 * Always empty for unscoped controllers, which is what keeps every branch below
 * identical to pre-profile behavior for them.
 */
const controllerFallbackForType = (
  shouldSendTo: ShouldSendTo,
  outputs: DisplayOutput[],
  type: PushOutputType,
  profile?: ControllerProfile | null
): string[] => {
  if (!usesControllerDefaults(profile)) return [];
  if (sendsNowhere(shouldSendTo)) return [];
  const byId = new Map(outputs.map((output) => [output.id, output]));
  return getControllerDefaultSendIds(profile, outputs).filter(
    (id) => byId.get(id)?.type === type,
  );
};

/** Displays this controller may address, in registry order. */
const selectableOutputs = (
  outputs: DisplayOutput[],
  profile?: ControllerProfile | null
): DisplayOutput[] =>
  profile
    ? getControllerOutputs(profile, outputs)
    : outputs.filter((output) => output.enabled);

/** Output ids to target for a surface type. Empty only when nothing matches. */
export const getSendTargetIdsForType = (
  shouldSendTo: ShouldSendTo,
  outputs: DisplayOutput[],
  type: PushOutputType,
  profile?: ControllerProfile | null
): string[] => {
  const selectable = selectableOutputs(outputs, profile).filter(
    (output) => output.type === type,
  );
  const selected = shouldSendTo.outputIds;
  // No selection: the built-in display for this surface, which is what the
  // reducers also fall back to.
  if (!selected || selected.length === 0) {
    if (selectable.some((output) => output.id === type)) return [type];
    return controllerFallbackForType(shouldSendTo, outputs, type, profile);
  }
  const narrowed = selectable
    .filter((output) => selected.includes(output.id))
    .map((output) => output.id);
  if (narrowed.length > 0) return narrowed;
  // The item names displays, but none this controller can reach.
  return controllerFallbackForType(
    shouldSendTo,
    outputs,
    type,
    profile
  );
};

/**
 * Does this item send to the surface at all?
 *
 * The surface toggle must be on, and — once displays are named — at least one
 * selected display must belong to that surface.
 *
 * A scoped controller ignores the surface toggles. They describe the
 * presentation controller's three surfaces, and an item saved as
 * "stream only" would otherwise be unshowable on a lobby projector even though
 * an operator deliberately put it in that outline.
 */
export const shouldSendToType = (
  shouldSendTo: ShouldSendTo,
  outputs: DisplayOutput[],
  type: PushOutputType,
  profile?: ControllerProfile | null
): boolean => {
  if (usesControllerDefaults(profile)) {
    if (sendsNowhere(shouldSendTo)) return false;
    return (
      getSendTargetIdsForType(shouldSendTo, outputs, type, profile)
        .length > 0
    );
  }
  if (!shouldSendTo[type]) return false;
  return (
    getSendTargetIdsForType(shouldSendTo, outputs, type, profile)
      .length > 0
  );
};

/**
 * Displays currently selected, defaulting to every enabled display.
 *
 * Must match what actually receives content, or the first toggle would look
 * like it deselected one screen while really dropping all the others.
 */
export const getSelectedSendTargetIds = (
  shouldSendTo: ShouldSendTo,
  outputs: DisplayOutput[],
  profile?: ControllerProfile | null
): string[] => {
  const scoped = usesControllerDefaults(profile);
  // Displays this controller can actually reach. Narrowed even when the profile
  // is unscoped, because another controller may own a screen this one has given
  // away — and the shown selection has to equal what a send would light up.
  const reachableIds = profile
    ? new Set(
        getControllerOutputs(profile, outputs).map(
          (output) => output.id,
        ),
      )
    : null;

  const selected = shouldSendTo.outputIds;
  if (selected && selected.length > 0) {
    const ids = outputs
      .filter((output) => output.enabled && selected.includes(output.id))
      .map((output) => output.id)
      // Only displays this controller drives; the rest belong to another
      // controller and are not this operator's to see or change.
      .filter((id) => !reachableIds || reachableIds.has(id));
    if (ids.length > 0 || !scoped) return ids;
  } else {
    const legacy = PUSH_TYPES.filter((type) => shouldSendTo[type])
      .filter((type) =>
        outputs.some((output) => output.id === type && output.enabled),
      )
      .filter((id) => !reachableIds || reachableIds.has(id));
    if (legacy.length > 0 || !scoped) return legacy;
  }

  // Scoped, and nothing the item names is reachable here: show the controller
  // defaults, because those are what a send would actually light up.
  if (sendsNowhere(shouldSendTo)) return [];
  return getControllerDefaultSendIds(profile, outputs);
};

/**
 * Starting targets for an item created on this controller.
 *
 * Uses the controller's configured defaults, falling back to every display it
 * drives. Without this a new item was born carrying the presentation
 * controller's three surface flags, which on a controller driving one screen
 * called something else resolved to nothing at all — the operator created an
 * item that silently went nowhere.
 */
export const buildShouldSendToForController = (
  outputs: DisplayOutput[],
  profile?: ControllerProfile | null,
): ShouldSendTo => {
  const available = profile
    ? getControllerOutputs(profile, outputs)
    : outputs.filter((output) => output.enabled);
  const configured = profile ? getControllerDefaultSendIds(profile, outputs) : [];
  const ids =
    configured.length > 0 ? configured : available.map((output) => output.id);
  const byId = new Map(outputs.map((output) => [output.id, output]));
  const hasType = (type: PushOutputType) =>
    ids.some((id) => byId.get(id)?.type === type);
  return {
    outputIds: ids,
    projector: hasType("projector"),
    monitor: hasType("monitor"),
    stream: hasType("stream"),
  };
};

/** Toggle one display in the selection, keeping the surface flags in step. */
export const toggleSendTarget = (
  shouldSendTo: ShouldSendTo,
  outputs: DisplayOutput[],
  outputId: string,
  profile?: ControllerProfile | null
): Partial<ShouldSendTo> => {
  const reachableIds = profile
    ? new Set(
        getControllerOutputs(profile, outputs).map(
          (output) => output.id,
        ),
      )
    : null;

  // Start from what the UI shows as selected, not from an empty list: the
  // default view marks displays on, so toggling one must remove only that one.
  const current = getSelectedSendTargetIds(
    shouldSendTo,
    outputs,
    profile
  );
  const isSelected = current.includes(outputId);
  const nextInScope = isSelected
    ? current.filter((id) => id !== outputId)
    : [...current, outputId];

  // Displays this controller cannot see keep their selection. Editing an item
  // from the lobby controller must never silently clear the sanctuary's targets
  // — and the reverse matters just as much, since the main controller no longer
  // sees a screen it has given away and would otherwise wipe it on the next
  // toggle.
  const outsideScope = reachableIds
    ? (shouldSendTo.outputIds ?? []).filter((id) => !reachableIds.has(id))
    : [];
  const outputIds = [...outsideScope, ...nextInScope];

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
