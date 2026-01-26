// ============================================================================
// Connection & Retry Constants
// ============================================================================

export const MAX_INITIAL_SESSION_RETRIES = 5;

// ============================================================================
// Display Window Constants
// ============================================================================

// Reference resolution for transform scaling (1920px × 1080px = 1080p)
export const REFERENCE_WIDTH = 1920; // pixels
export const REFERENCE_HEIGHT = 1080; // pixels

// Font size multiplier: converts fontSize value to pixels at reference resolution
// Formula: fontSize * FONT_SIZE_MULTIPLIER = pixels
export const FONT_SIZE_MULTIPLIER = 200 / 4.5;

// ============================================================================
// Time Picker Constants
// ============================================================================

export const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
export const HOURS_24 = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0")
);
export const MINUTES = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0")
);
export const SECONDS = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0")
);

export const pad2 = (v: string | number) => String(v).padStart(2, "0");
