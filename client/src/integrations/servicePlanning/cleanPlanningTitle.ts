/**
 * Strips common planning-printout decorations from song titles before matching
 * against the local song library.
 */
export const cleanPlanningTitle = (title: string): string => {
  let s = title.trim();

  // Strip leading musical note characters.
  s = s.replace(/^(?:[\u266A\u266B\u266C]|\uD83C\uDFB5|\uD83C\uDFB6)\s*/u, "");

  // Strip prefixes like "Hymn 499 - " and numbered catalog formats like
  // "341-To God Be the Glory" or "341–To God Be the Glory".
  s = s.replace(/^hymn\s*#?\s*\d+\s*[-:\u2013\u2014]\s*/i, "");
  s = s.replace(/^\d+\s*[-:\u2013\u2014]\s*/u, "");

  // Trailing planning parens: modulation "(G→A)", "(Eb -> F)", key "(F)", "(C#)", etc.
  let prev: string;
  do {
    prev = s;
    s = s.replace(/\s*\([A-G][#b]?\s*(?:→|->|\u2192)\s*[A-G][#b]?\)\s*$/i, "");
    s = s.replace(/\s*\([A-G][#b]?\)\s*$/i, "");
  } while (s !== prev);

  // Strip suffixes like "Hymn #341" after removing the trailing key.
  s = s.replace(/\s+hymn\s*#?\s*\d+\s*$/i, "");

  return s.replace(/\s{2,}/g, " ").trim();
};
