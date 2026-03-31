import { SongMetadata } from "../types";

export type RawLrclibTrack = Record<string, unknown>;

export type NormalizedLrclibTrack = Omit<SongMetadata, "source" | "importedAt">;

const asString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return undefined;
};

const normalizeDurationMs = (value: unknown): number | undefined => {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return undefined;

  // LRCLIB commonly exposes duration in seconds. Persist milliseconds.
  return Math.round(numericValue < 10000 ? numericValue * 1000 : numericValue);
};

export const extractPlainLyricsFromSyncedLyrics = (
  syncedLyrics?: string | null,
): string | null => {
  if (!syncedLyrics?.trim()) return null;

  const plainText = syncedLyrics
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]+\]/g, "").trim())
    .filter((line) => line.length > 0)
    .join("\n");

  return plainText.trim() || null;
};

export const normalizeLrclibTrack = (
  rawTrack: RawLrclibTrack,
): NormalizedLrclibTrack => {
  const lrclibId = Number(
    rawTrack.lrclibId ??
      rawTrack.id ??
      rawTrack.trackId ??
      rawTrack.track_id ??
      0,
  );
  const trackName =
    asString(rawTrack.trackName) ??
    asString(rawTrack.track_name) ??
    asString(rawTrack.name) ??
    "";
  const artistName =
    asString(rawTrack.artistName) ??
    asString(rawTrack.artist_name) ??
    asString(rawTrack.artist) ??
    "";

  if (!Number.isFinite(lrclibId) || lrclibId <= 0 || !trackName || !artistName) {
    throw new Error("Invalid LRCLIB track payload");
  }

  const syncedLyrics =
    asString(rawTrack.syncedLyrics) ??
    asString(rawTrack.synced_lyrics) ??
    null;
  const plainLyrics =
    asString(rawTrack.plainLyrics) ??
    asString(rawTrack.plain_lyrics) ??
    extractPlainLyricsFromSyncedLyrics(syncedLyrics) ??
    null;

  return {
    lrclibId,
    trackName,
    artistName,
    albumName:
      asString(rawTrack.albumName) ??
      asString(rawTrack.album_name) ??
      asString(rawTrack.album),
    durationMs: normalizeDurationMs(
      rawTrack.durationMs ?? rawTrack.duration_ms ?? rawTrack.duration,
    ),
    instrumental: asBoolean(rawTrack.instrumental),
    plainLyrics,
    syncedLyrics,
  };
};

export const createSongMetadataFromLrclib = (
  track: NormalizedLrclibTrack,
  importedAt = new Date().toISOString(),
): SongMetadata => ({
  source: "lrclib",
  importedAt,
  ...track,
});

export const getImportableLyricsFromTrack = (
  track: Pick<NormalizedLrclibTrack, "plainLyrics" | "syncedLyrics">,
): string => {
  return (
    track.plainLyrics ??
    extractPlainLyricsFromSyncedLyrics(track.syncedLyrics) ??
    ""
  ).trim();
};

export const makeUniqueArrangementName = (
  baseName: string,
  arrangementNames: string[],
): string => {
  if (!arrangementNames.includes(baseName)) return baseName;

  let suffix = 2;
  while (arrangementNames.includes(`${baseName} ${suffix}`)) {
    suffix += 1;
  }

  return `${baseName} ${suffix}`;
};
