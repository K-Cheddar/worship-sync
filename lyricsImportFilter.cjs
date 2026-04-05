const profanityFilter = require("leo-profanity");

profanityFilter.loadDictionary("en");

const getString = (value) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
};

const metadataIndicatesExplicit = (
  trackName,
  albumName,
  name,
  artistName,
) => {
  const parts = [trackName, albumName, name, artistName].filter(Boolean);
  for (const part of parts) {
    if (/\([^)]*\bexplicit\b[^)]*\)/i.test(part)) return true;
    if (/\[[^\]]*\bexplicit\b[^\]]*\]/i.test(part)) return true;
    if (/\bexplicit\s+version\b/i.test(part)) return true;
    if (/\bexplicit\s+audio\b/i.test(part)) return true;
    if (/\bexplicit\s+album\b/i.test(part)) return true;
  }
  return false;
};

const lyricsIndicateExplicit = (plainLyrics, syncedLyrics) => {
  const plain = typeof plainLyrics === "string" ? plainLyrics.trim() : "";
  const syncedRaw = typeof syncedLyrics === "string" ? syncedLyrics.trim() : "";
  const raw = plain || syncedRaw;
  if (!raw) return false;

  const head = raw.slice(0, 1200);
  const firstLines = head.split(/\r?\n/).slice(0, 8).join("\n");

  if (
    /^\s*\[(?:explicit|explicit\s+content|parental\s+advisory)\]/i.test(
      firstLines.trim(),
    )
  ) {
    return true;
  }
  if (/\bparental\s+advisory[\s:]+explicit\b/i.test(firstLines)) return true;
  if (
    /^\s*\[\d+:\d+\.\d+\]\s*\[(?:explicit|explicit\s+content)\]/i.test(
      firstLines.trim(),
    )
  ) {
    return true;
  }
  return false;
};

const normalizeForProfanityCheck = (text) => {
  if (typeof text !== "string") return "";
  return text.replace(/\[[^\]]+\]/g, " ").trim();
};

const containsProfanity = (text) => {
  const normalizedText = normalizeForProfanityCheck(text);
  if (!normalizedText) return false;
  return profanityFilter.check(normalizedText);
};

const shouldExcludeLyricsImport = (track) => {
  if (!track || typeof track !== "object") return false;

  const explicitFlag = getBoolean(track.explicit);
  if (explicitFlag === true) return true;

  const trackName =
    getString(track.trackName) ?? getString(track.track_name) ?? "";
  const artistName =
    getString(track.artistName) ??
    getString(track.artist_name) ??
    getString(track.artist) ??
    "";
  const albumName =
    getString(track.albumName) ??
    getString(track.album_name) ??
    getString(track.album) ??
    "";
  const name = getString(track.name) ?? "";

  if (metadataIndicatesExplicit(trackName, albumName, name, artistName)) {
    return true;
  }

  if (
    containsProfanity(trackName) ||
    containsProfanity(albumName) ||
    containsProfanity(name) ||
    containsProfanity(artistName)
  ) {
    return true;
  }

  const plainLyrics =
    getString(track.plainLyrics) ?? getString(track.plain_lyrics);
  const syncedLyrics =
    getString(track.syncedLyrics) ?? getString(track.synced_lyrics);

  if (lyricsIndicateExplicit(plainLyrics, syncedLyrics)) return true;
  if (containsProfanity(plainLyrics) || containsProfanity(syncedLyrics)) {
    return true;
  }

  return false;
};

module.exports = {
  shouldExcludeLyricsImport,
};
