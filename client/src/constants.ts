import { buildTieredFontSizePresets } from "./utils/fontSizePresets";

// ============================================================================
// Connection & Retry Constants
// ============================================================================

export const MAX_INITIAL_SESSION_RETRIES = 5;
export const MAX_REPLICATION_AUTH_RETRIES = 3;

/** No `dbProgress` change while below 100% → show stuck-recovery UI (wall-clock). */
export const STUCK_DB_PROGRESS_MS = 15_000;

// ============================================================================
// Display Window Constants
// ============================================================================

// Reference resolution for transform scaling (1920px × 1080px = 1080p)
export const REFERENCE_WIDTH = 1920; // pixels
export const REFERENCE_HEIGHT = 1080; // pixels

// Monitor next-slide layout band heights (percent of REFERENCE_HEIGHT)
export const MONITOR_BAND_CLOCK_TIMER_PERCENT = 10;
export const MONITOR_BAND_CURRENT_PERCENT = 50;
export const MONITOR_BAND_NEXT_PERCENT = 40;

export const MONITOR_BAND_CLOCK_TIMER_PX =
  (REFERENCE_HEIGHT * MONITOR_BAND_CLOCK_TIMER_PERCENT) / 100;
export const MONITOR_BAND_CURRENT_PX =
  (REFERENCE_HEIGHT * MONITOR_BAND_CURRENT_PERCENT) / 100;
export const MONITOR_BAND_NEXT_PX =
  (REFERENCE_HEIGHT * MONITOR_BAND_NEXT_PERCENT) / 100;

// Font size: stored as pixels. Default when box.fontSize is unset (legacy ~44px).
export const DEFAULT_FONT_PX = 108;
export const DEFAULT_TITLE_FONT_PX = 150;
/** Step for +/- font size toolbar buttons (px for slide boxes; formatted-text display scale). */
export const FONT_SIZE_BUTTON_STEP = 1;

/** Slide Tools font size field bounds (px). */
export const MIN_SLIDE_FONT_PX = 25;
export const MAX_SLIDE_FONT_PX = 500;

/** Lowest value in the Slide Tools font size preset dropdown (px). */
export const FONT_SIZE_PRESET_MIN_PX = 50;

/** Tiered Slide Tools font size presets: finer steps at low sizes, coarser at high sizes. */
export const SLIDE_FONT_SIZE_PRESET_TIERS = [
  { from: FONT_SIZE_PRESET_MIN_PX, to: 150, step: 5 },
  { from: 150, to: 300, step: 10 },
  { from: 300, to: MAX_SLIDE_FONT_PX, step: 25 },
] as const;

export const FONT_SIZE_PRESETS: readonly number[] = buildTieredFontSizePresets(
  SLIDE_FONT_SIZE_PRESET_TIERS,
  MAX_SLIDE_FONT_PX,
);

// ============================================================================
// Time Picker Constants
// ============================================================================

export const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
export const HOURS_24 = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0"),
);
export const MINUTES = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0"),
);
export const SECONDS = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0"),
);

export const pad2 = (v: string | number) => String(v).padStart(2, "0");

// ============================================================================
// UI accents
// ============================================================================

/**
 * Lucide MonitorX (clear display) in transmit handler and preview headers.
 * Pale amber (~`#f59e0b` at 58% + white) — softer than full amber-500, distinct from Live green.
 */
export const CLEAR_ACTION_ICON_COLOR = "#f9c771";
