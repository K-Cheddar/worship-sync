/**
 * Display outputs: the dynamic replacement for the hardcoded
 * projector / monitor / stream triple.
 *
 * An **output** is a named content target. A paired screen subscribes to one
 * output, so three projectors showing three different things are three
 * projector-type outputs, while two screens mirroring the same content share a
 * single output and cost no extra presentation state.
 *
 * Outputs come in two kinds:
 *
 * - **Push** (`projector`, `monitor`, `stream`) — the controller sends content
 *   at them. They own presentation state, a transmit toggle, and prev/current
 *   crossfade state.
 * - **Pull** (`credits`, `stream-info`, `board`) — they render straight from a
 *   church data node. They own a {@link DisplayOutputSource} binding instead,
 *   and deliberately have no presentation state, no transmit toggle, and no
 *   send-target membership. Forcing them into the push shape would leave dead
 *   `slide` fields and a Live toggle that does nothing.
 *
 * `type` stays what it has always been in `DisplayWindow`: a **render profile**,
 * not an identity.
 *
 * The three push built-ins keep the literal ids `projector`, `monitor`, and
 * `stream` so they map 1:1 onto the existing Firebase keys (`projectorInfo`,
 * `monitorInfo`, `streamInfo`). That is what lets new and old clients share a
 * church during rollout — see {@link getLegacyPresentationKey}.
 */
import generateRandomId from "./generateRandomId";
import { DisplaySettings, normalizeDisplaySettings } from "./displaySettings";

/** Render profiles the controller pushes presentation content to. */
export const PUSH_OUTPUT_TYPES = ["projector", "monitor", "stream"] as const;

/** Render profiles that render from a church data source instead. */
export const PULL_OUTPUT_TYPES = ["credits", "stream-info", "board"] as const;

export type PushOutputType = (typeof PUSH_OUTPUT_TYPES)[number];
export type PullOutputType = (typeof PULL_OUTPUT_TYPES)[number];
export type DisplayOutputType = PushOutputType | PullOutputType;

export const DISPLAY_OUTPUT_TYPES: DisplayOutputType[] = [
  ...PUSH_OUTPUT_TYPES,
  ...PULL_OUTPUT_TYPES,
];

/** Default operator-facing names. Avoids "Stream-info" from naive capitalization. */
export const DISPLAY_OUTPUT_TYPE_LABELS: Record<DisplayOutputType, string> = {
  projector: "Projector",
  monitor: "Monitor",
  stream: "Stream",
  credits: "Credits",
  "stream-info": "Stream Info",
  board: "Board",
};

/**
 * Configured content binding for a pull output. This is **registry config**
 * (which board that foyer screen shows — changes rarely), not the live
 * board-on-monitor override, which stays in presentation state so it syncs at
 * live-gesture speed.
 */
export type DisplayOutputSource = {
  /** `board` outputs only: alias of the discussion board to render. */
  boardAliasId?: string;
};

export type DisplayOutput = {
  id: string;
  type: DisplayOutputType;
  /** Operator-facing name, e.g. "Main", "Lobby", "Foyer Board". */
  name: string;
  /** Ascending sort order for controller previews and pickers. */
  order: number;
  /**
   * Retired outputs stay in the registry (so their quick links, paired screens,
   * and history survive) but are hidden from controllers and receive no content.
   */
  enabled: boolean;
  /** Pull outputs only; always absent on push outputs. */
  source?: DisplayOutputSource;
  /**
   * Default settings for every screen showing this display. A screen may
   * override any field; see `resolveDisplaySettings`.
   */
  settings?: DisplaySettings;
};

export const isPushOutputType = (
  type: DisplayOutputType,
): type is PushOutputType =>
  (PUSH_OUTPUT_TYPES as readonly string[]).includes(type);

export const isPullOutputType = (
  type: DisplayOutputType,
): type is PullOutputType =>
  (PULL_OUTPUT_TYPES as readonly string[]).includes(type);

export const isPushOutput = (output: DisplayOutput) =>
  isPushOutputType(output.type);

export const isPullOutput = (output: DisplayOutput) =>
  isPullOutputType(output.type);

/**
 * Seeded outputs present in every church. Renameable and retirable, but never
 * removable: each corresponds to a product surface that already exists, and the
 * push three additionally have presentation state older clients read directly.
 */
export const BUILT_IN_OUTPUT_IDS = [
  "projector",
  "monitor",
  "stream",
  "credits",
  "stream-info",
  "board",
] as const;

export type BuiltInOutputId = (typeof BUILT_IN_OUTPUT_IDS)[number];

export const isBuiltInOutputId = (id: string): id is BuiltInOutputId =>
  (BUILT_IN_OUTPUT_IDS as readonly string[]).includes(id);

/**
 * Ids whose presentation state predates the registry and is still stored under
 * flat Firebase keys. Strictly the push three — pull outputs never had any.
 */
const LEGACY_PRESENTATION_OUTPUT_IDS: readonly string[] = [
  "projector",
  "monitor",
  "stream",
];

/** Legacy Firebase key under `presentation/` for a push built-in, else null. */
export const getLegacyPresentationKey = (outputId: string) =>
  LEGACY_PRESENTATION_OUTPUT_IDS.includes(outputId) ? `${outputId}Info` : null;

export const DEFAULT_DISPLAY_OUTPUTS: DisplayOutput[] = [
  {
    id: "projector",
    type: "projector",
    name: "Projector",
    order: 0,
    enabled: true,
  },
  { id: "monitor", type: "monitor", name: "Monitor", order: 1, enabled: true },
  { id: "stream", type: "stream", name: "Stream", order: 2, enabled: true },
  { id: "credits", type: "credits", name: "Credits", order: 3, enabled: true },
  {
    id: "stream-info",
    type: "stream-info",
    name: "Stream Info",
    order: 4,
    enabled: true,
  },
  { id: "board", type: "board", name: "Board", order: 5, enabled: true },
];

export const getDefaultDisplayOutputs = (): DisplayOutput[] =>
  DEFAULT_DISPLAY_OUTPUTS.map((output) => ({ ...output }));

const MAX_OUTPUT_NAME_LENGTH = 40;

const isDisplayOutputType = (value: unknown): value is DisplayOutputType =>
  typeof value === "string" &&
  (DISPLAY_OUTPUT_TYPES as string[]).includes(value);

export const createDisplayOutputId = () => `out_${generateRandomId()}`;

/** Trim, collapse whitespace, and cap length. Empty input falls back to the type label. */
export const sanitizeDisplayOutputName = (
  name: unknown,
  type: DisplayOutputType,
) => {
  const cleaned = String(name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_OUTPUT_NAME_LENGTH);
  return cleaned || DISPLAY_OUTPUT_TYPE_LABELS[type];
};

/**
 * Suffix a name until it no longer collides (case-insensitively) with `taken`.
 * Operators pick outputs by name under time pressure, so duplicates are unsafe.
 */
export const getUniqueDisplayOutputName = (
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
  return `${name} ${createDisplayOutputId()}`;
};

/**
 * Keep only the source fields the type actually understands, so a push output
 * can never carry a stale binding and there is exactly one source of truth.
 */
export const normalizeDisplayOutputSource = (
  raw: unknown,
  type: DisplayOutputType,
): DisplayOutputSource | undefined => {
  if (type !== "board") return undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const boardAliasId = String(
    (raw as Record<string, unknown>).boardAliasId ?? "",
  ).trim();
  return boardAliasId ? { boardAliasId } : undefined;
};

/** Configured board alias for a board output, or "" when unbound. */
export const getBoardAliasForOutput = (output: DisplayOutput) =>
  output.type === "board" ? (output.source?.boardAliasId ?? "") : "";

/**
 * Can this render profile show a discussion board in place of presentation
 * content?
 *
 * Projector and monitor are full-frame room surfaces, so a board can take the
 * whole screen. Stream cannot: it has to stay transparent for compositing, and
 * it already carries board posts as an overlay rather than a takeover.
 */
export const supportsBoardTakeover = (type: DisplayOutputType) =>
  type === "projector" || type === "monitor";

/**
 * Sequence of output ids after dragging one visible row onto another.
 *
 * Reordering acts on the rows an operator can actually see. Dragging within the
 * full registry would shuffle pull outputs that are not listed, so those keep
 * their relative order at the end of the sequence instead.
 *
 * Returns null when the drag changes nothing.
 */
export const reorderVisibleOutputIds = (
  visibleIds: string[],
  allIds: string[],
  activeId: string,
  overId: string,
): string[] | null => {
  if (activeId === overId) return null;
  const next = [...visibleIds];
  const from = next.indexOf(activeId);
  const to = next.indexOf(overId);
  if (from < 0 || to < 0) return null;
  next.splice(to, 0, next.splice(from, 1)[0]);
  return [...next, ...allIds.filter((id) => !next.includes(id))];
};

/** Sentinel order for entries whose stored `order` was missing or unparseable. */
const UNORDERED = Number.MAX_SAFE_INTEGER;

/** Reassign contiguous `order` values so gaps from removals never accumulate. */
const withContiguousOrder = (outputs: DisplayOutput[]): DisplayOutput[] =>
  outputs.map((output, index) =>
    output.order === index ? output : { ...output, order: index },
  );

/**
 * Parse whatever Firebase hands back into a sound registry.
 *
 * Accepts the RTDB object-map form (`{ id: {...} }`), an array, or null/garbage
 * from a church that has never written the node. Always returns the built-ins —
 * a malformed or partial payload must never leave a controller unable to reach
 * the projector.
 */
export const normalizeDisplayOutputs = (raw: unknown): DisplayOutput[] => {
  const entries = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.values(raw as Record<string, unknown>)
      : [];

  const byId = new Map<string, DisplayOutput>();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const id = String(candidate.id ?? "").trim();
    if (!id || byId.has(id)) continue;
    if (!isDisplayOutputType(candidate.type)) continue;
    const type = candidate.type;
    const order = Number(candidate.order);
    const source = normalizeDisplayOutputSource(candidate.source, type);
    const settings = normalizeDisplaySettings(candidate.settings, type);
    byId.set(id, {
      id,
      type,
      name: sanitizeDisplayOutputName(candidate.name, type),
      order: Number.isFinite(order) ? order : UNORDERED,
      // Absent means enabled: churches written before the flag existed are live.
      enabled: candidate.enabled !== false,
      ...(source ? { source } : {}),
      ...(settings ? { settings } : {}),
    });
  }

  // Append restored built-ins after everything the payload defined, rather than
  // at their default order — otherwise a built-in the payload dropped would jump
  // into the middle of a registry the church has deliberately ordered.
  // Entries carrying the UNORDERED sentinel are excluded, so they stay last
  // instead of pushing restored built-ins past the end of the number line.
  let nextOrder = Array.from(byId.values()).reduce(
    (highest, output) =>
      output.order === UNORDERED
        ? highest
        : Math.max(highest, output.order + 1),
    0,
  );

  // Restore any built-in the payload dropped, keeping its canonical type.
  for (const fallback of getDefaultDisplayOutputs()) {
    const existing = byId.get(fallback.id);
    if (!existing) {
      byId.set(fallback.id, { ...fallback, order: nextOrder });
      nextOrder += 1;
      continue;
    }
    if (existing.type !== fallback.type) {
      const source = normalizeDisplayOutputSource(
        existing.source,
        fallback.type,
      );
      const { source: _dropped, ...rest } = existing;
      byId.set(fallback.id, {
        ...rest,
        type: fallback.type,
        ...(source ? { source } : {}),
      });
    }
  }

  const sorted = Array.from(byId.values()).sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name),
  );
  return withContiguousOrder(sorted);
};

/**
 * Serialize for Firebase as an id-keyed map (stable under concurrent edits).
 * Omits absent `source` rather than writing `undefined`, which RTDB rejects.
 */
export const serializeDisplayOutputs = (
  outputs: DisplayOutput[],
): Record<string, DisplayOutput> =>
  outputs.reduce<Record<string, DisplayOutput>>((acc, output) => {
    const { source, settings, ...rest } = output;
    acc[output.id] = {
      ...rest,
      ...(source ? { source } : {}),
      ...(settings ? { settings } : {}),
    };
    return acc;
  }, {});

export const getEnabledDisplayOutputs = (outputs: DisplayOutput[]) =>
  outputs.filter((output) => output.enabled);

export const getDisplayOutputsByType = (
  outputs: DisplayOutput[],
  type: DisplayOutputType,
) => outputs.filter((output) => output.type === type);

/** Outputs the controller sends presentation content to. */
export const getPushOutputs = (outputs: DisplayOutput[]) =>
  outputs.filter(isPushOutput);

/** Outputs bound to a church data source rather than driven by the controller. */
export const getPullOutputs = (outputs: DisplayOutput[]) =>
  outputs.filter(isPullOutput);

/**
 * Resolve the output a screen should render. Falls back to the first enabled
 * output of the paired surface type, then the built-in of that type, so a screen
 * whose output was retired mid-service still shows something rather than
 * going blank.
 */
export const resolveOutputForScreen = (
  outputs: DisplayOutput[],
  requestedOutputId: string | null | undefined,
  surfaceType: DisplayOutputType,
): DisplayOutput => {
  const requested = requestedOutputId
    ? outputs.find((output) => output.id === requestedOutputId)
    : undefined;
  if (requested?.enabled && requested.type === surfaceType) return requested;

  // Known but the wrong profile, e.g. /projector-full?output=monitor: fall back,
  // or the page would render a monitor slot with the projector profile.
  const isCrossType = Boolean(requested) && requested?.type !== surfaceType;

  // Named a display we do not know: the registry may simply not have synced.
  // Use that id anyway rather than borrowing another display's content — Main
  // appearing on the lobby projector is worse than that display's own blank
  // slot. A retired display of the right type keeps its own slot too.
  if (requestedOutputId && !isCrossType) {
    return (
      requested ?? {
        id: requestedOutputId,
        type: surfaceType,
        name: requestedOutputId,
        order: Number.MAX_SAFE_INTEGER,
        enabled: true,
      }
    );
  }

  const firstEnabledOfType = outputs.find(
    (output) => output.type === surfaceType && output.enabled,
  );
  if (firstEnabledOfType) return firstEnabledOfType;

  return (
    outputs.find((output) => output.id === surfaceType) ??
    getDefaultDisplayOutputs().find((output) => output.type === surfaceType) ??
    getDefaultDisplayOutputs()[0]
  );
};
