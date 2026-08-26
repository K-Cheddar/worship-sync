import { SongMetadata } from "../types";

export type RawLrclibTrack = Record<string, unknown>;

export type NormalizedLrclibTrack = Omit<SongMetadata, "importedAt">;

export const getLyricsImportSourceLabel = (
  source: NormalizedLrclibTrack["source"],
): string => {
  const labels = {
    genius: "Genius",
    lyricsovh: "Lyrics.ovh",
    lrclib: "LRCLIB",
    manual: "Manual",
  } as const;
  return labels[source];
};

export const getLyricsImportSourceBadgeClass = (
  source: NormalizedLrclibTrack["source"],
): string => {
  const classes = {
    genius:
      "border-fuchsia-400/45 bg-fuchsia-400/10 text-fuchsia-200",
    lrclib: "border-cyan-400/45 bg-cyan-400/10 text-cyan-200",
    lyricsovh: "border-amber-400/45 bg-amber-400/10 text-amber-200",
    manual: "border-slate-400/45 bg-slate-400/10 text-slate-200",
  } as const;

  return classes[source];
};

const lyricsImportSourceOrder: Record<
  NormalizedLrclibTrack["source"],
  number
> = {
  genius: 0,
  lyricsovh: 1,
  lrclib: 2,
  manual: 3,
};

export const sortLyricsImportTracksBySource = (
  tracks: NormalizedLrclibTrack[],
): NormalizedLrclibTrack[] =>
  tracks
    .map((track, index) => ({ track, index }))
    .sort(
      (left, right) =>
        lyricsImportSourceOrder[left.track.source] -
          lyricsImportSourceOrder[right.track.source] ||
        left.index - right.index,
    )
    .map(({ track }) => track);

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

  const lines = syncedLyrics
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]+\]/g, "").trim());

  // LRC files timestamp section pauses as blank lines. Collapse runs of them
  // into a single blank line instead of dropping them entirely, so imported
  // lyrics keep the same verse/chorus breaks Genius imports have.
  const collapsedLines: string[] = [];
  for (const line of lines) {
    const isBlank = line.length === 0;
    const previousIsBlank =
      collapsedLines.length > 0 &&
      collapsedLines[collapsedLines.length - 1].length === 0;
    if (isBlank && (previousIsBlank || collapsedLines.length === 0)) continue;
    collapsedLines.push(line);
  }
  while (
    collapsedLines.length > 0 &&
    collapsedLines[collapsedLines.length - 1].length === 0
  ) {
    collapsedLines.pop();
  }

  const plainText = collapsedLines.join("\n").trim();
  return plainText || null;
};

const scoreImportableLyricsText = (text: string): number => {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return 0;

  if (!normalized.includes("\n")) {
    return normalized.length > 80 ? 1 : normalized.length;
  }

  const sectionBreaks = (normalized.match(/\n\n/g) || []).length;
  const lineCount = normalized
    .split("\n")
    .filter((line) => line.trim().length > 0).length;

  return sectionBreaks * 100 + lineCount;
};

const pickBestImportablePlainLyrics = (
  plainLyrics?: string | null,
  derivedFromSynced?: string | null,
): string | null => {
  const plain = plainLyrics?.trim() ?? "";
  const syncedDerived = derivedFromSynced?.trim() ?? "";

  if (!plain && !syncedDerived) return null;
  if (!plain) return syncedDerived;
  if (!syncedDerived) return plain;

  const plainScore = scoreImportableLyricsText(plain);
  const syncedScore = scoreImportableLyricsText(syncedDerived);

  return syncedScore > plainScore ? syncedDerived : plain;
};

/** Higher scores mean lyrics are more likely to split cleanly into sections on import. */
export const getLyricsImportStructureScore = (
  track: Pick<NormalizedLrclibTrack, "plainLyrics" | "syncedLyrics">,
): number => {
  const text =
    pickBestImportablePlainLyrics(
      track.plainLyrics,
      extractPlainLyricsFromSyncedLyrics(track.syncedLyrics),
    ) ?? "";

  return scoreImportableLyricsText(text);
};

export const sortLrclibTracksByLyricsStructure = (
  tracks: NormalizedLrclibTrack[],
): NormalizedLrclibTrack[] => {
  if (tracks.length <= 1) return tracks;

  return [...tracks].sort((left, right) => {
    const scoreDelta =
      getLyricsImportStructureScore(right) -
      getLyricsImportStructureScore(left);

    if (scoreDelta !== 0) return scoreDelta;

    const leftId = left.lrclibId ?? 0;
    const rightId = right.lrclibId ?? 0;
    return rightId - leftId;
  });
};

export const normalizeLrclibTrack = (
  rawTrack: RawLrclibTrack,
): NormalizedLrclibTrack => {
  const requestedSource = asString(rawTrack.source);
  const source =
    requestedSource === "genius" || requestedSource === "lyricsovh"
      ? requestedSource
      : "lrclib";
  const lrclibId = Number(
    rawTrack.lrclibId ??
      rawTrack.id ??
      rawTrack.trackId ??
      rawTrack.track_id ??
      0,
  );
  const geniusId = Number(rawTrack.geniusId ?? 0);
  const lyricsOvhKey = asString(rawTrack.lyricsOvhKey);
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

  const hasValidLrclibId = Number.isFinite(lrclibId) && lrclibId > 0;
  const hasValidGeniusId = Number.isFinite(geniusId) && geniusId > 0;

  if (
    !trackName ||
    !artistName ||
    (source === "lrclib" && !hasValidLrclibId) ||
    (source === "genius" && !hasValidGeniusId) ||
    (source === "lyricsovh" && !lyricsOvhKey)
  ) {
    throw new Error("Invalid lyrics import track payload");
  }

  const syncedLyrics =
    asString(rawTrack.syncedLyrics) ?? asString(rawTrack.synced_lyrics) ?? null;
  const plainLyrics = pickBestImportablePlainLyrics(
    asString(rawTrack.plainLyrics) ?? asString(rawTrack.plain_lyrics),
    extractPlainLyricsFromSyncedLyrics(syncedLyrics),
  );

  return {
    source,
    ...(hasValidLrclibId ? { lrclibId } : {}),
    ...(hasValidGeniusId ? { geniusId } : {}),
    ...(lyricsOvhKey ? { lyricsOvhKey } : {}),
    geniusUrl: asString(rawTrack.geniusUrl) ?? asString(rawTrack.url),
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
  importedAt,
  ...track,
});

export const createManualSongMetadata = (
  fields: {
    trackName: string;
    artistName: string;
    albumName?: string;
    key?: string;
  },
  importedAt = new Date().toISOString(),
): SongMetadata => ({
  source: "manual",
  trackName: fields.trackName.trim(),
  artistName: fields.artistName.trim(),
  ...(fields.albumName?.trim() ? { albumName: fields.albumName.trim() } : {}),
  ...(fields.key?.trim() ? { key: fields.key.trim() } : {}),
  importedAt,
});

export const getImportableLyricsFromTrack = (
  track: Pick<NormalizedLrclibTrack, "plainLyrics" | "syncedLyrics">,
): string => {
  return (
    pickBestImportablePlainLyrics(
      track.plainLyrics,
      extractPlainLyricsFromSyncedLyrics(track.syncedLyrics),
    ) ?? ""
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
