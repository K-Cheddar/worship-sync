/**
 * Strips key/transposition annotations and hymn prefixes from planning titles
 * before matching against the local song library.
 *
 * Examples:
 *   "♫ You Deserve It (F)"               → "You Deserve It"
 *   "🎵 How Great Thou Art (C#)"          → "How Great Thou Art"
 *   "Hymn 499 - What A Friend We Have"    → "What A Friend We Have"
 *   "Psalm 78:1-8 NIV"                    → "Psalm 78:1-8 NIV"  (unchanged — looks like scripture)
 */
export const cleanPlanningTitle = (title: string): string => {
  let s = title.trim();

  // Strip leading musical note characters
  s = s.replace(/^[♫🎵]\s*/u, "");

  // Strip "Hymn NNN - " or "Hymn NNN:" prefixes
  s = s.replace(/^hymn\s+\d+\s*[-:]\s*/i, "");

  // Trailing key annotation: " (F)", " (C#)", " (Eb)", " (Ab)", " (G)", etc.
  // Match a capital letter optionally followed by b/#, inside parens at end of string.
  s = s.replace(/\s*\([A-G][#b]?\)\s*$/i, "");

  return s.replace(/\s{2,}/g, " ").trim();
};
