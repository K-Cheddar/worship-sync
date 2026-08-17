/**
 * Per-display settings.
 *
 * Settings resolve in two tiers:
 *
 * - **Output defaults** live in the display registry. Set the clock once on
 *   "Main" and every screen showing Main inherits it.
 * - **Screen overrides** belong to one physical screen. This is what lets two
 *   projectors show identical content while only the stage-facing one carries
 *   the clock, and it is the only sane home for `isHeadless`, which describes
 *   the window rather than the content.
 *
 * Every field is optional at both tiers: `undefined` means "inherit", which is
 * what makes a per-field override possible at all.
 */
import { DisplayOutputType, PushOutputType } from "./displayOutputs";

export type DisplaySettings = {
  /** Clock in the monitor-style band. */
  showClock?: boolean;
  /** Countdown timer in the band. */
  showTimer?: boolean;
  clockFontSize?: number;
  timerFontSize?: number;
  /**
   * Preview of the next slide. Send-time: it changes the payload the controller
   * builds, so it is resolved as a union across a display's screens rather than
   * purely at render.
   */
  showNextSlide?: boolean;
  /** Render the slide's media background. Never applies to stream. */
  showBackground?: boolean;
  /** Whether local video-input slides play their linked audio on this screen. */
  localVideoAudioEnabled?: boolean;
  /** Local video-input volume from 0 (silent) to 100 (full level). */
  localVideoVolume?: number;
  /**
   * Screen-level only. A headless screen has no window chrome and no button to
   * enter fullscreen; a windowed one does.
   */
  isHeadless?: boolean;
};

/** Matches the values these settings had when they were church-wide. */
export const DISPLAY_SETTINGS_DEFAULTS: Required<
  Omit<DisplaySettings, "isHeadless">
> & {
  isHeadless: boolean;
} = {
  showClock: true,
  showTimer: true,
  clockFontSize: 75,
  timerFontSize: 75,
  showNextSlide: false,
  showBackground: true,
  localVideoAudioEnabled: false,
  localVideoVolume: 100,
  isHeadless: false,
};

export type ResolvedDisplaySettings = typeof DISPLAY_SETTINGS_DEFAULTS;

/**
 * Defaults that differ by render profile.
 *
 * A monitor showed text on black before it was configurable, and churches did
 * not ask for slide media on their lyric monitors. Defaulting `showBackground`
 * to the shipped `true` would switch that on for every existing church without
 * anyone touching a control, so the monitor keeps its old behaviour until an
 * operator opts in. A projector has always shown backgrounds.
 */
const TYPE_DEFAULT_OVERRIDES: Partial<
  Record<DisplayOutputType, Partial<ResolvedDisplaySettings>>
> = {
  monitor: { showBackground: false },
};

/** Shipped defaults for a render profile. */
export const getDefaultsForType = (
  type?: DisplayOutputType,
): ResolvedDisplaySettings => ({
  ...DISPLAY_SETTINGS_DEFAULTS,
  ...(type ? (TYPE_DEFAULT_OVERRIDES[type] ?? {}) : {}),
});

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 200;
const LOCAL_VIDEO_VOLUME_MIN = 0;
const LOCAL_VIDEO_VOLUME_MAX = 100;

const clampFontSize = (value: unknown, fallback: number) => {
  const size = Number(value);
  if (!Number.isFinite(size)) return fallback;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)));
};

/**
 * Which settings a render profile actually understands.
 *
 * The settings UI filters on this so operators never see a toggle that does
 * nothing, and resolution forces the rest to their defaults so a stale value
 * cannot leak into a surface that should ignore it.
 */
export const getApplicableSettingKeys = (
  type: DisplayOutputType,
): (keyof DisplaySettings)[] => {
  if (type === "stream") {
    // Stream stays transparent and has no clock/timer band, but a local video
    // input can still route sound through an OBS/browser-source screen.
    return ["localVideoAudioEnabled", "localVideoVolume"];
  }
  if (type === "monitor") {
    return [
      "showClock",
      "showTimer",
      "clockFontSize",
      "timerFontSize",
      "showNextSlide",
      "showBackground",
      "localVideoAudioEnabled",
      "localVideoVolume",
    ];
  }
  if (type === "projector") {
    return [
      "showClock",
      "showTimer",
      "clockFontSize",
      "timerFontSize",
      "showBackground",
      "localVideoAudioEnabled",
      "localVideoVolume",
    ];
  }
  // Pull surfaces composite the same band over their own content.
  return [
    "showClock",
    "showTimer",
    "clockFontSize",
    "timerFontSize",
  ];
};

/**
 * Whether a render profile has chrome for headless mode to strip.
 *
 * Only the projector and monitor pages gate on a "Click to go Fullscreen"
 * screen. Stream is bare by necessity — an OBS browser source cannot click a
 * button, and the page has to stay transparent for compositing — and the pull
 * surfaces already render bare, so the toggle would be inert on all of them.
 *
 * This is deliberately separate from `getApplicableSettingKeys`: `isHeadless`
 * is a screen override and never an output default, so it must not reach
 * `normalizeDisplaySettings`.
 */
export const supportsHeadless = (type: DisplayOutputType) =>
  type === "projector" || type === "monitor";

/** Drop values a type does not understand and coerce the rest. */
export const normalizeDisplaySettings = (
  raw: unknown,
  type: DisplayOutputType,
): DisplaySettings | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = raw as Record<string, unknown>;
  const allowed = new Set<string>(getApplicableSettingKeys(type));
  const next: DisplaySettings = {};

  if (allowed.has("showClock") && typeof candidate.showClock === "boolean") {
    next.showClock = candidate.showClock;
  }
  if (allowed.has("showTimer") && typeof candidate.showTimer === "boolean") {
    next.showTimer = candidate.showTimer;
  }
  if (
    allowed.has("showNextSlide") &&
    typeof candidate.showNextSlide === "boolean"
  ) {
    next.showNextSlide = candidate.showNextSlide;
  }
  if (
    allowed.has("showBackground") &&
    typeof candidate.showBackground === "boolean"
  ) {
    next.showBackground = candidate.showBackground;
  }
  if (
    allowed.has("localVideoAudioEnabled") &&
    typeof candidate.localVideoAudioEnabled === "boolean"
  ) {
    next.localVideoAudioEnabled = candidate.localVideoAudioEnabled;
  }
  if (
    allowed.has("localVideoVolume") &&
    candidate.localVideoVolume != null
  ) {
    const volume = Number(candidate.localVideoVolume);
    if (Number.isFinite(volume)) {
      next.localVideoVolume = Math.min(
        LOCAL_VIDEO_VOLUME_MAX,
        Math.max(LOCAL_VIDEO_VOLUME_MIN, Math.round(volume)),
      );
    }
  }
  if (allowed.has("clockFontSize") && candidate.clockFontSize != null) {
    next.clockFontSize = clampFontSize(
      candidate.clockFontSize,
      DISPLAY_SETTINGS_DEFAULTS.clockFontSize,
    );
  }
  if (allowed.has("timerFontSize") && candidate.timerFontSize != null) {
    next.timerFontSize = clampFontSize(
      candidate.timerFontSize,
      DISPLAY_SETTINGS_DEFAULTS.timerFontSize,
    );
  }

  return Object.keys(next).length ? next : undefined;
};

/**
 * Merge the two tiers per field. A screen override wins; `undefined` inherits
 * the output default; anything still unset falls back to the shipped default.
 *
 * `isHeadless` is screen-only by design — an output default for it would be
 * meaningless, since it describes a window and not the content.
 *
 * Pass `type` so profile-specific defaults apply; without it every profile gets
 * the shipped defaults, which is what previews and editors want.
 */
export const resolveDisplaySettings = (
  outputDefaults: DisplaySettings | undefined,
  screenOverrides?: DisplaySettings,
  type?: DisplayOutputType,
): ResolvedDisplaySettings => {
  const defaults = getDefaultsForType(type);
  const pick = <K extends keyof DisplaySettings>(
    key: K,
  ): NonNullable<DisplaySettings[K]> | ResolvedDisplaySettings[K] => {
    const override = screenOverrides?.[key];
    if (override !== undefined) return override as never;
    const base = outputDefaults?.[key];
    if (base !== undefined) return base as never;
    return defaults[key] as never;
  };

  return {
    showClock: pick("showClock") as boolean,
    showTimer: pick("showTimer") as boolean,
    clockFontSize: pick("clockFontSize") as number,
    timerFontSize: pick("timerFontSize") as number,
    showNextSlide: pick("showNextSlide") as boolean,
    showBackground: pick("showBackground") as boolean,
    localVideoAudioEnabled: pick("localVideoAudioEnabled") as boolean,
    localVideoVolume: pick("localVideoVolume") as number,
    isHeadless: (screenOverrides?.isHeadless ??
      defaults.isHeadless) as boolean,
  };
};

/**
 * Does any screen on this display want the next-slide preview?
 *
 * `showNextSlide` shapes the payload before it is sent, so the controller sends
 * it when **any** subscriber wants it and each screen decides whether to render.
 * Sending it unconditionally would put an extra slide's boxes into every
 * presentation write on a live path.
 */
export const shouldSendNextSlideForOutput = (
  outputDefaults: DisplaySettings | undefined,
  screenOverrides: DisplaySettings[] = [],
) => {
  const base =
    outputDefaults?.showNextSlide ?? DISPLAY_SETTINGS_DEFAULTS.showNextSlide;
  // No screens registered: the display's own default decides.
  if (screenOverrides.length === 0) return base;
  // Otherwise send when any screen would render it, resolving each the same way
  // the screen itself will.
  return screenOverrides.some((screen) => screen.showNextSlide ?? base);
};

/** Settings that predate the registry, migrated onto the monitor display. */
export type LegacyMonitorSettings = {
  showClock?: boolean;
  showTimer?: boolean;
  showNextSlide?: boolean;
  clockFontSize?: number;
  timerFontSize?: number;
  timerId?: string | null;
};

export const fromLegacyMonitorSettings = (
  legacy: LegacyMonitorSettings | null | undefined,
  type: PushOutputType = "monitor",
): DisplaySettings | undefined => normalizeDisplaySettings(legacy, type);

/**
 * The output-default tier for a display, with the church's pre-registry
 * settings underneath.
 *
 * Configuring one field leaves a display with a *partial* settings object.
 * Choosing between the tiers — `settings ?? legacy` — would drop every field
 * the operator never touched to a shipped default, so a church's clock, timer
 * and font sizes changed the first time anyone flipped Background. Merging
 * keeps the untouched fields on the church's values until they are configured.
 *
 * Every resolver must go through here rather than merging locally: the last
 * time this was fixed in one caller, three others kept the old behaviour.
 */
export const resolveOutputDefaults = (
  outputSettings: DisplaySettings | undefined,
  legacyMonitorSettings?: LegacyMonitorSettings | null,
  type: PushOutputType = "monitor",
): DisplaySettings | undefined => {
  const legacy = fromLegacyMonitorSettings(legacyMonitorSettings, type);
  if (!legacy) return outputSettings;
  return { ...legacy, ...(outputSettings ?? {}) };
};
