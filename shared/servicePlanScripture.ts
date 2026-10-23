const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const readString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** Display-only projection: the saved translation wins over an older label. */
export const getServicePlanScriptureLabel = (
  reference: unknown,
  fallbackLabel = "",
): string => {
  const ref = asRecord(reference);
  const label = readString(ref.label) || fallbackLabel.trim();
  const version = readString(ref.version).toUpperCase();
  const book = readString(ref.book);
  const chapter = readString(ref.chapter);
  const startVerse = readString(ref.startVerse);
  const endVerse = readString(ref.endVerse);
  const verseRange = readString(ref.verseRange) ||
    (startVerse && endVerse ? `${startVerse}-${endVerse}` : startVerse);
  const passage = book && chapter
    ? `${book} ${chapter}${verseRange ? `:${verseRange}` : ""}`
    : "";
  if (!version) return label || passage || "Scripture";

  const suffix = /\s+(?:\(([A-Za-z0-9-]+)\)|([A-Za-z][A-Za-z0-9-]*))$/;
  const match = label.match(suffix);
  if (match && (match[1] || match[2]).toUpperCase() === version) {
    return label.slice(0, match.index) + (match[1] ? ` (${version})` : ` ${version}`);
  }
  return `${passage || label.replace(suffix, "") || "Scripture"} ${version}`;
};

/** Scripture resources support both nested references and legacy flat data. */
export const getServicePlanScriptureResourceTitle = (resource: {
  title?: string;
  data?: Record<string, unknown>;
}): string => {
  const data = resource.data;
  return getServicePlanScriptureLabel(
    data?.scripture ?? data?.scriptureRef ?? data,
    resource.title,
  );
};
