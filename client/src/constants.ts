// ============================================================================
// Connection & Retry Constants
// ============================================================================

export const MAX_INITIAL_SESSION_RETRIES = 5;
export const MAX_REPLICATION_AUTH_RETRIES = 3;

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
export const DEFAULT_TITLE_FONT_PX = 180;

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
