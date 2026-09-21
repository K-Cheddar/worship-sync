import { getYouTubeVideoReference } from "../../utils/youtube";
import type { DBItem } from "../../types";

export type YouTubePlaylistEntry = {
  entryKey: string;
  songId: string;
  title: string;
  artist: string;
  videoId: string;
  durationSeconds?: number;
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
    return [
      {
        entryKey: key,
        songId: song._id,
        title: song.name,
        artist: song.songMetadata?.artistName?.trim() || "",
        videoId: video.videoId,
        ...(link.durationSeconds === undefined
          ? {}
          : { durationSeconds: link.durationSeconds }),
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
