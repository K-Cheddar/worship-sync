/** Normalizes planning element type text for fuzzy overlay.event matching (legacy Get names behavior). */
export const normalizeElementTypeForMatch = (elementType: string): string => {
  const elementLower = elementType.toLowerCase().replace(/\s+/g, " ").trim();
  return elementLower
    .replace(/song of praise.*?\([^)]+\)/g, "song of praise")
    .replace(/congregational hymn.*?\([^)]+\)/g, "hymn")
    .replace(/welcome song.*?\([^)]+\)/g, "welcome song")
    .replace(/appeal song.*?\([^)]+\)/g, "appeal song")
    .replace(/after glow.*?\([^)]+\)/g, "after glow")
    .replace(/appreciation.*?\([^)]+\)/g, "appreciation")
    .replace(/call to (praise|prayer)/g, "call to $1")
    .replace(/reading the word.*?-.*$/g, "reading")
    .replace(/sermon.*?-.*$/g, "sermon")
    .replace(/children.*?-.*$/g, "children")
    .replace(/mission.*?-.*$/g, "mission")
    .replace(/sabbath school.*?-.*$/g, "sabbath school")
    .replace(/pastoral greetings.*\/.*$/g, "announcements")
    .trim();
};
