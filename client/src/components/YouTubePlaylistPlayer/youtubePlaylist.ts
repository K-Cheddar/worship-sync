import { getYouTubeVideoReference } from "../../utils/youtube";
import type { DBItem, SongLinkSegment } from "../../types";

export type YouTubePlaybackRange = {
  startSeconds?: number;
  endSeconds?: number;
};

export type YouTubePlaylistEntry = {
  entryKey: string;
  songId: string;
  title: string;
  artist: string;
  videoId: string;
  playbackRanges: YouTubePlaybackRange[];
  durationSeconds?: number;
};

const isValidSegment = (segment: SongLinkSegment) =>
  Number.isSafeInteger(segment.startSeconds) &&
  segment.startSeconds >= 0 &&
  (segment.endSeconds === undefined ||
    (Number.isSafeInteger(segment.endSeconds) &&
      segment.endSeconds > segment.startSeconds));

const getEffectiveDuration = (
  ranges: YouTubePlaybackRange[],
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

export const getFirstYouTubeLink = (song?: DBItem) =>
  song?.songLinks?.find((link) => getYouTubeVideoReference(link.url)) ?? null;

export const buildYouTubePlaylistQueue = (
  entries: Array<{ key: string; song?: DBItem }>,
): YouTubePlaylistEntry[] =>
  entries.flatMap(({ key, song }) => {
    if (!song) return [];
    const link = getFirstYouTubeLink(song);
    const video = link ? getYouTubeVideoReference(link.url) : null;
    if (!link || !video) return [];
    const segments = (link.segments ?? []).filter(isValidSegment);
    const playbackRanges: YouTubePlaybackRange[] = segments.length
      ? segments.map(({ startSeconds, endSeconds }) => ({
          startSeconds,
          ...(endSeconds === undefined ? {} : { endSeconds }),
        }))
      : [{ ...(video.startSeconds === undefined ? {} : { startSeconds: video.startSeconds }) }];
    const durationSeconds = getEffectiveDuration(
      playbackRanges,
      link.durationSeconds,
    );
    return [
      {
        entryKey: key,
        songId: song._id,
        title: song.name,
        artist: song.songMetadata?.artistName?.trim() || "",
        videoId: video.videoId,
        playbackRanges,
        ...(durationSeconds === undefined
          ? {}
          : { durationSeconds }),
      },
    ];
  });

export const findAvailablePlaylistIndex = (
  queue: YouTubePlaylistEntry[],
  failedKeys: ReadonlySet<string>,
  start: number,
  direction: 1 | -1,
) => {
  for (let index = start; index >= 0 && index < queue.length; index += direction) {
    if (!failedKeys.has(queue[index].entryKey)) return index;
  }
  return null;
};
