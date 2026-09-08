/**
 * Controller profiles: which controller surface owns which displays.
 *
 * A **controller** is an operator surface that drives content — the presentation
 * controller, the overlay controller, and now auxiliary controllers that each
 * feed their own audience-facing screen. Until this registry existed a
 * controller was only a route, and every controller could reach every display.
 * That is fine while there is one projector; it stops being fine the moment a
 * church runs two audience screens with deliberately different content, because
 * nothing prevents the lobby operator from taking over the sanctuary.
 *
 * A profile answers two questions the product previously had no place to store:
 *
 * - **Which displays may this controller drive?** (`outputIds`) Sends are
 *   narrowed to this set, so reaching another controller's screen is not a
 *   mistake an operator can make under time pressure — see `sendTargets.ts`.
 * - **Where do new items go by default?** (`defaultSendOutputIds`) Items added
 *   from a controller land on that controller's screens without configuration.
 *
 * This deliberately mirrors {@link ./displayOutputs} in shape and in its
 * tolerance for bad data: a malformed payload must never leave an operator
 * unable to reach their screen, so the built-ins always survive normalization.
 */
import generateRandomId from "./generateRandomId";
import { DisplayOutput, PUSH_OUTPUT_TYPES } from "./displayOutputs";

/**
 * What kind of operator surface a profile describes.
 *
 * `aux-presentation` is the extensible one: a slim presentation controller that
 * owns its own outlines and its own screens. Every auxiliary controller a church
 * adds is one of these, which is what keeps controller number four configuration
 * rather than a new code path.
 */
export const CONTROLLER_PROFILE_TYPES = [
  "presentation",
  "overlay",
  "aux-presentation",
] as const;

export type ControllerProfileType = (typeof CONTROLLER_PROFILE_TYPES)[number];

export type ControllerProfile = {
  id: string;
  type: ControllerProfileType;
  /** Operator-facing name, e.g. "Presentation", "Lobby". */
  name: string;
  /** Ascending sort order for pickers and navigation. */
  order: number;
  /**
   * Retired controllers stay in the registry so their outlines and quick links
   * survive, but are hidden from navigation and drive nothing.
   */
  enabled: boolean;
  /**
   * Push displays this controller drives. Any controller can be given any
   * display; what differs between them is only what they start with.
   *
   * Read through {@link getEffectiveOutputIds}, never directly: until an
   * operator saves a choice this list is empty and the controller's defaults
   * apply instead.
   */
  outputIds: string[];
  /**
   * Has an operator saved a display choice for this controller?
   *
   * Needed because RTDB cannot store an empty array — it drops the key — so a
   * controller deliberately given no displays is indistinguishable on read from
   * one nobody has touched. The two mean opposite things: untouched falls back
   * to {@link getDefaultOutputIds}, whereas configured-and-empty means the
   * controller drives nothing.
   */
  outputsConfigured: boolean;
  /**
   * Displays stamped onto items created or added from this controller. Empty
   * means "stamp nothing" and leaves the item's own defaults alone, which is
   * what both built-ins want.
   */
  defaultSendOutputIds: string[];
  /**
   * Outline scope key. Outlines carry the scope of the controller that created
   * them, so each controller's picker shows only its own — see
   * `outlineScope.ts`. Normally equal to {@link id}.
   */
  outlineScope: string;
};

export const PRESENTATION_CONTROLLER_ID = "presentation";
export const OVERLAY_CONTROLLER_ID = "overlay";

/**
 * Seeded profiles present in every church. Renameable and reconfigurable, but
 * never removable: each is a route that already exists, and the presentation
 * profile is the fallback every unscoped outline and legacy item resolves
 * against.
 */
export const BUILT_IN_CONTROLLER_IDS = [
  PRESENTATION_CONTROLLER_ID,
  OVERLAY_CONTROLLER_ID,
] as const;

export type BuiltInControllerId = (typeof BUILT_IN_CONTROLLER_IDS)[number];

export const isBuiltInControllerId = (id: string): id is BuiltInControllerId =>
  (BUILT_IN_CONTROLLER_IDS as readonly string[]).includes(id);

/**
 * Defaults matching pre-registry behavior exactly.
 *
 * Both built-ins are deliberately unrestricted and stamp nothing, so a church
 * that never opens the Controllers panel behaves precisely as it did before the
 * registry existed. Every narrowing this file enables is opt-in.
 *
 * The overlay profile shares the presentation outline scope: the overlay
 * controller reads the same outlines today, and giving it a scope of its own
 * would empty its picker on upgrade.
 */
export const DEFAULT_CONTROLLER_PROFILES: ControllerProfile[] = [
  {
    id: PRESENTATION_CONTROLLER_ID,
    type: "presentation",
    name: "Presentation",
    order: 0,
    enabled: true,
    outputIds: [],
    outputsConfigured: false,
    defaultSendOutputIds: [],
    outlineScope: PRESENTATION_CONTROLLER_ID,
  },
  {
    id: OVERLAY_CONTROLLER_ID,
    type: "overlay",
    name: "Overlays",
    order: 1,
    enabled: true,
    outputIds: [],
    outputsConfigured: false,
    defaultSendOutputIds: [],
    outlineScope: PRESENTATION_CONTROLLER_ID,
  },
];

export const getDefaultControllerProfiles = (): ControllerProfile[] =>
  DEFAULT_CONTROLLER_PROFILES.map((profile) => ({
    ...profile,
    outputIds: [...profile.outputIds],
    defaultSendOutputIds: [...profile.defaultSendOutputIds],
  }));

/**
 * Displays a controller starts with before anyone configures it.
 *
 * The built-in ids, so this matches the surfaces each controller already drives:
 * the presentation controller runs the room, overlays run the stream. A new
 * controller starts empty — creating one should never put a screen on air.
 */
export const getDefaultOutputIds = (
  type: ControllerProfileType,
): string[] => {
  if (type === "presentation") return [...PUSH_OUTPUT_TYPES];
  if (type === "overlay") return ["stream"];
  return [];
};

/** The displays this controller drives: its saved choice, or its defaults. */
export const getEffectiveOutputIds = (profile: ControllerProfile): string[] =>
  profile.outputsConfigured || profile.outputIds.length > 0
    ? profile.outputIds
    : getDefaultOutputIds(profile.type);

const MAX_PROFILE_NAME_LENGTH = 40;

export const createControllerProfileId = () => `ctrl_${generateRandomId()}`;

const isControllerProfileType = (
  value: unknown,
): value is ControllerProfileType =>
  typeof value === "string" &&
  (CONTROLLER_PROFILE_TYPES as readonly string[]).includes(value);

/** Trim, collapse whitespace, cap length. Empty input falls back to "Controller". */
export const sanitizeControllerProfileName = (name: unknown) => {
  const cleaned = String(name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROFILE_NAME_LENGTH);
  return cleaned || "Controller";
};

/**
 * Suffix a name until it no longer collides case-insensitively. Operators pick
 * controllers by name, and two screens both called "Lobby" is exactly the kind
 * of ambiguity that costs a service.
 */
export const getUniqueControllerProfileName = (
  name: string,
  taken: Iterable<string>,
) => {
  const takenLower = new Set(
    Array.from(taken, (value) => value.trim().toLowerCase()),
  );
  if (!takenLower.has(name.toLowerCase())) return name;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${name} ${suffix}`;
    if (!takenLower.has(candidate.toLowerCase())) return candidate;
  }
  return `${name} ${createControllerProfileId()}`;
};

/** Unique, order-preserving list of non-empty string ids. */
const normalizeIdList = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) {
    // RTDB collapses arrays with gaps into object maps, so accept that shape.
    if (raw && typeof raw === "object") {
      return normalizeIdList(Object.values(raw as Record<string, unknown>));
    }
    return [];
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of raw) {
    const id = String(entry ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
};

/** Sentinel order for entries whose stored `order` was missing or unparseable. */
const UNORDERED = Number.MAX_SAFE_INTEGER;

const withContiguousOrder = (
  profiles: ControllerProfile[],
): ControllerProfile[] =>
  profiles.map((profile, index) =>
    profile.order === index ? profile : { ...profile, order: index },
  );

/**
 * Parse whatever Firebase hands back into a sound registry.
 *
 * Accepts the RTDB object-map form, an array, or null from a church that has
 * never written the node. Always returns the built-ins: a bad write upstream
 * must not strip a controller's route to its displays mid-service.
 */
export const normalizeControllerProfiles = (
  raw: unknown,
): ControllerProfile[] => {
  const entries = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.values(raw as Record<string, unknown>)
      : [];

  const byId = new Map<string, ControllerProfile>();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const id = String(candidate.id ?? "").trim();
    if (!id || byId.has(id)) continue;
    if (!isControllerProfileType(candidate.type)) continue;
    const order = Number(candidate.order);
    const outlineScope = String(candidate.outlineScope ?? "").trim() || id;
    byId.set(id, {
      id,
      type: candidate.type,
      name: sanitizeControllerProfileName(candidate.name),
      order: Number.isFinite(order) ? order : UNORDERED,
      // Absent means enabled: churches written before the flag existed are live.
      enabled: candidate.enabled !== false,
      outputIds: normalizeIdList(candidate.outputIds),
      // Always a boolean: RTDB rejects undefined, and an absent flag has to read
      // as "never configured" rather than as missing data.
      outputsConfigured: candidate.outputsConfigured === true,
      defaultSendOutputIds: normalizeIdList(candidate.defaultSendOutputIds),
      outlineScope,
    });
  }

  // Append restored built-ins after everything the payload defined rather than
  // at their default order, so a built-in the payload dropped does not jump into
  // the middle of a registry the church has deliberately ordered.
  let nextOrder = Array.from(byId.values()).reduce(
    (highest, profile) =>
      profile.order === UNORDERED
        ? highest
        : Math.max(highest, profile.order + 1),
    0,
  );

  for (const fallback of getDefaultControllerProfiles()) {
    const existing = byId.get(fallback.id);
    if (!existing) {
      byId.set(fallback.id, { ...fallback, order: nextOrder });
      nextOrder += 1;
      continue;
    }
    // A built-in's type is canonical: the presentation profile behaving as an
    // overlay controller would silently change where every legacy item sends.
    if (existing.type !== fallback.type) {
      byId.set(fallback.id, { ...existing, type: fallback.type });
    }
  }

  const sorted = Array.from(byId.values()).sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name),
  );
  return withContiguousOrder(sorted);
};

/** Serialize for Firebase as an id-keyed map (stable under concurrent edits). */
export const serializeControllerProfiles = (
  profiles: ControllerProfile[],
): Record<string, ControllerProfile> =>
  profiles.reduce<Record<string, ControllerProfile>>((acc, profile) => {
    acc[profile.id] = { ...profile };
    return acc;
  }, {});

export const getEnabledControllerProfiles = (profiles: ControllerProfile[]) =>
  profiles.filter((profile) => profile.enabled);

/** Auxiliary controllers, in registry order. These are the ones with their own pages. */
export const getAuxControllerProfiles = (profiles: ControllerProfile[]) =>
  profiles.filter(
    (profile) => profile.type === "aux-presentation" && profile.enabled,
  );

export const findControllerProfile = (
  profiles: ControllerProfile[],
  id: string | null | undefined,
): ControllerProfile | undefined =>
  id ? profiles.find((profile) => profile.id === id) : undefined;

/**
 * The profile to resolve against, falling back to presentation.
 *
 * Callers on a surface with no controller context (a display window, a quick
 * link fired from the home page) still need targeting to resolve, and the
 * presentation profile owns the built-ins — which is exactly the pre-registry
 * behavior.
 */
export const resolveControllerProfile = (
  profiles: ControllerProfile[],
  id: string | null | undefined,
): ControllerProfile => {
  const found = findControllerProfile(profiles, id);
  if (found) return found;

  // An id we do not recognise, but that is not a built-in, names an auxiliary
  // controller whose registry entry has not arrived. Stand in for it with a
  // profile that drives nothing rather than falling through to presentation:
  // a surface waiting on its settings must never inherit another controller's
  // screens. Its own outlines still resolve, because the scope is the id.
  if (id && !isBuiltInControllerId(id)) return synthesizeAuxProfile(id);

  return (
    findControllerProfile(profiles, PRESENTATION_CONTROLLER_ID) ??
    getDefaultControllerProfiles()[0]
  );
};

/**
 * Stand-in for an auxiliary controller whose registry entry is not loaded.
 *
 * Deliberately drives no displays. The page can render, the operator can work
 * their outline, and nothing can reach a screen until the real profile arrives.
 */
const synthesizeAuxProfile = (id: string): ControllerProfile => ({
  id,
  type: "aux-presentation",
  name: "Controller",
  order: Number.MAX_SAFE_INTEGER,
  enabled: true,
  outputIds: [],
  outputsConfigured: true,
  defaultSendOutputIds: [],
  outlineScope: id,
});

/** Is this profile a real registry entry, or a stand-in awaiting one? */
export const isKnownControllerProfile = (
  profiles: ControllerProfile[],
  profile: ControllerProfile,
) => profiles.some((entry) => entry.id === profile.id);


/**
 * Displays this controller drives, narrowed to those that still exist and are
 * enabled.
 *
 * Assignment is explicit, so there is no cross-controller arithmetic here: a
 * display reaches a controller because someone put it on that controller's
 * list. A disabled controller drives nothing at all.
 *
 * Order follows the display registry rather than the profile's stored list, so
 * previews and pickers stay in the order the church arranged their screens.
 */
export const getControllerOutputs = (
  profile: ControllerProfile,
  outputs: DisplayOutput[],
): DisplayOutput[] => {
  if (!profile.enabled) return [];
  const allowed = new Set(getEffectiveOutputIds(profile));
  return outputs.filter(
    (output) =>
      output.enabled &&
      (PUSH_OUTPUT_TYPES as readonly string[]).includes(output.type) &&
      allowed.has(output.id),
  );
};

/**
 * Default send targets for new items on this controller, or an empty list when
 * the controller stamps nothing and the item's own defaults should stand.
 *
 * Ids the controller no longer owns are dropped: a default pointing at an
 * unreachable display would create items that send nowhere, which reads to an
 * operator as a broken item rather than stale configuration.
 */
export const getControllerDefaultSendIds = (
  profile: ControllerProfile,
  outputs: DisplayOutput[],
): string[] => {
  if (profile.defaultSendOutputIds.length === 0) return [];
  const availableIds = new Set(
    getControllerOutputs(profile, outputs).map((output) => output.id),
  );
  return profile.defaultSendOutputIds.filter((id) => availableIds.has(id));
};

/**
 * The display set after switching one display on or off for this controller.
 *
 * Starts from what the controller *currently* drives, not from its stored list.
 * On a never-configured built-in the stored list is empty while the controller
 * really drives every screen, so starting from the stored list would turn one
 * click into "drive only this one" — the operator would take a screen away and
 * lose all the others.
 *
 * Displays the live view cannot represent — retired ones, or ids the registry
 * has not synced — keep their place, so turning a screen off for a week does not
 * quietly unassign it.
 */
export const toggleControllerOutput = (
  profile: ControllerProfile,
  outputs: DisplayOutput[],
  outputId: string,
  next: boolean,
): string[] => {
  const live = getControllerOutputs(profile, outputs).map(
    (output) => output.id,
  );
  const updated = next
    ? live.includes(outputId)
      ? live
      : [...live, outputId]
    : live.filter((id) => id !== outputId);

  const representable = new Set(
    outputs
      .filter(
        (output) =>
          output.enabled &&
          (PUSH_OUTPUT_TYPES as readonly string[]).includes(output.type),
      )
      .map((output) => output.id),
  );
  const preserved = profile.outputIds.filter((id) => !representable.has(id));

  return [...preserved, ...updated];
};

/** May this controller drive the display? */
export const controllerOwnsOutput = (
  profile: ControllerProfile,
  outputId: string,
) => getEffectiveOutputIds(profile).includes(outputId);

/**
 * Which controller a display belongs to, for operator-facing copy like
 * "driven by Lobby". Returns the first enabled owner in registry order; a
 * display shared by config has more than one, and the first is its home.
 *
 * Only scoped profiles claim ownership — an unscoped built-in can reach every
 * display, and reporting it as the owner of all of them would be noise.
 */
export const getOwningControllerProfile = (
  profiles: ControllerProfile[],
  outputId: string,
): ControllerProfile | undefined =>
  profiles.find(
    (profile) =>
      profile.enabled && getEffectiveOutputIds(profile).includes(outputId),
  );

/**
 * Controllers other than `exceptId` that claim this display.
 *
 * Used to warn before handing a screen to a second controller: two operators
 * pushing at one screen is legal by config but never accidental.
 */
export const getControllersClaimingOutput = (
  profiles: ControllerProfile[],
  outputId: string,
  exceptId?: string,
): ControllerProfile[] =>
  profiles.filter(
    (profile) =>
      profile.enabled &&
      profile.id !== exceptId &&
      getEffectiveOutputIds(profile).includes(outputId),
  );
