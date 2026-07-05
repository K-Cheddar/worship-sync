/**
 * Shared helpers for ranking and choosing LRCLIB lyrics with usable section breaks.
 */

const scoreImportableLyricsText = (text) => {
  if (typeof text !== "string" || !text.trim()) return 0;

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  // LRCLIB sometimes stores an entire song as one space-separated line.
  if (!normalized.includes("\n")) {
    return normalized.length > 80 ? 1 : normalized.length;
  }

  const sectionBreaks = (normalized.match(/\n\n/g) || []).length;
  const lineCount = normalized
    .split("\n")
    .filter((line) => line.trim().length > 0).length;

  return sectionBreaks * 100 + lineCount;
};

const pickBestImportablePlainLyrics = (plainLyrics, derivedFromSynced) => {
  const plain =
    typeof plainLyrics === "string" && plainLyrics.trim().length > 0
      ? plainLyrics.trim()
      : "";
  const syncedDerived =
    typeof derivedFromSynced === "string" && derivedFromSynced.trim().length > 0
      ? derivedFromSynced.trim()
      : "";

  if (!plain && !syncedDerived) return null;
  if (!plain) return syncedDerived;
  if (!syncedDerived) return plain;

  const plainScore = scoreImportableLyricsText(plain);
  const syncedScore = scoreImportableLyricsText(syncedDerived);

  return syncedScore > plainScore ? syncedDerived : plain;
};

const getLyricsImportStructureScore = ({ plainLyrics, syncedLyrics } = {}) => {
  const plain =
    typeof plainLyrics === "string" && plainLyrics.trim().length > 0
      ? plainLyrics.trim()
      : "";
  return scoreImportableLyricsText(plain);
};

const sortLyricsImportTracksByStructure = (tracks) => {
  if (!Array.isArray(tracks) || tracks.length <= 1) return tracks ?? [];

  return [...tracks].sort((left, right) => {
    const scoreDelta =
      getLyricsImportStructureScore(right) -
      getLyricsImportStructureScore(left);

    if (scoreDelta !== 0) return scoreDelta;

    const leftId = Number(left?.lrclibId ?? 0);
    const rightId = Number(right?.lrclibId ?? 0);
    return rightId - leftId;
  });
};

module.exports = {
  getLyricsImportStructureScore,
  pickBestImportablePlainLyrics,
  scoreImportableLyricsText,
  sortLyricsImportTracksByStructure,
};
