import type { DBItem, SongAudio, SongLinkSegment } from "../../types";
import { getServicePlanSongRefLabel } from "../../integrations/servicePlanning/formatSongTitleWithKey";
import { getYouTubeVideoReference } from "../../utils/youtube";
import type { ServicePlanSongReference } from "../../types/servicePlan";

export type PlaybackRange = {
  startSeconds?: number;
  endSeconds?: number;
};

export type RehearsalPlaybackEntry = {
  entryKey: string;
  songId: string;
  title: string;
  artist?: string;
  effectiveKey?: string;
  source:
    | {
        kind: "youtube";
        videoId: string;
        ranges: PlaybackRange[];
        durationSeconds?: number;
      }
    | {
        kind: "audio";
        audio: SongAudio;
        durationSeconds?: number;
      };
};

export const getRehearsalPlaybackEntryKey = (key: string, planKey?: string) =>
  planKey ? `${planKey}:${key}` : key;

type RehearsalSongInput = {
  key: string;
  songRef: ServicePlanSongReference;
  song?: DBItem;
};

const isValidSegment = (segment: SongLinkSegment) =>
  Number.isSafeInteger(segment.startSeconds) &&
  segment.startSeconds >= 0 &&
  (segment.endSeconds === undefined ||
    (Number.isSafeInteger(segment.endSeconds) &&
      segment.endSeconds > segment.startSeconds));

const getEffectiveDuration = (
  ranges: PlaybackRange[],
  fullDurationSeconds?: number,
) => {
  let total = 0;
  for (const range of ranges) {
    if (range.endSeconds !== undefined) {
      total += range.endSeconds - (range.startSeconds ?? 0);
    } else if (fullDurationSeconds !== undefined) {
      const remaining = fullDurationSeconds - (range.startSeconds ?? 0);
      if (remaining < 0) return undefined;
      total += remaining;
    } else {
      return undefined;
    }
  }
  return total;
};

const getYouTubeSource = (song?: DBItem): RehearsalPlaybackEntry["source"] | null => {
  const link = song?.songLinks?.find((candidate) =>
    getYouTubeVideoReference(candidate.url),
  );
  const video = link ? getYouTubeVideoReference(link.url) : null;
  if (!link || !video) return null;
  const segments = (link.segments ?? []).filter(isValidSegment);
  const ranges: PlaybackRange[] = segments.length
    ? segments.map(({ startSeconds, endSeconds }) => ({
        startSeconds,
        ...(endSeconds === undefined ? {} : { endSeconds }),
      }))
    : [{ ...(video.startSeconds === undefined ? {} : { startSeconds: video.startSeconds }) }];
  const durationSeconds = getEffectiveDuration(ranges, link.durationSeconds);
  return {
    kind: "youtube",
    videoId: video.videoId,
    ranges,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  };
};

/** YouTube stays the default rehearsal source; an explicit row MP3 request can override it. */
export const buildRehearsalPlaybackQueue = (
  entries: RehearsalSongInput[],
  audioEntryKey?: string,
  planKey?: string,
): RehearsalPlaybackEntry[] =>
  entries.flatMap(({ key, song, songRef }) => {
    if (!song) return [];
    const youtube = getYouTubeSource(song);
    const useAudio = key === audioEntryKey;
    const source = useAudio && song.songAudio
      ? { kind: "audio" as const, audio: song.songAudio }
      : youtube ?? (song.songAudio
          ? { kind: "audio" as const, audio: song.songAudio }
          : null);
    if (!source) return [];
    const effectiveKey = songRef.key?.trim() || song.songMetadata?.key?.trim() || "";
    return [{
      entryKey: getRehearsalPlaybackEntryKey(key, planKey),
      songId: song._id,
      title: songRef.kind === "pending"
        ? getServicePlanSongRefLabel(songRef) || song.name
        : song.name,
      ...(song.songMetadata?.artistName?.trim()
        ? { artist: song.songMetadata.artistName.trim() }
        : {}),
      ...(effectiveKey ? { effectiveKey } : {}),
      source,
    }];
  });
