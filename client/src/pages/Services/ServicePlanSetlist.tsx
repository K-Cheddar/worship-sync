import { Music2, Play, Search } from "lucide-react";
import { useContext, useMemo, useRef, useState } from "react";

import { getSongAudioUrl } from "../../api/auth";
import type { YouTubeSearchResult } from "../../api/auth";
import Button from "../../components/Button/Button";
import SongAudioPlayer from "../../components/SongAudioPlayer/SongAudioPlayer";
import SongLinkPreview from "../../components/SongLinkPreview/SongLinkPreview";
import YouTubeVideoPicker from "../../components/YouTubeVideoPicker/YouTubeVideoPicker";
import YouTubePlaylistPlayer, {
  type YouTubePlaylistPlayerHandle,
} from "../../components/YouTubePlaylistPlayer/YouTubePlaylistPlayer";
import {
  buildYouTubePlaylistQueue,
  getFirstYouTubeLink,
} from "../../components/YouTubePlaylistPlayer/youtubePlaylist";
import { GlobalInfoContext } from "../../context/globalInfo";
import type { DBItem } from "../../types";
import {
  getServicePlanElementSongRefs,
  type ServicePlanSection,
  type ServicePlanSongReference,
} from "../../types/servicePlan";
import { getServicePlanSongRefLabel } from "../../integrations/servicePlanning/formatSongTitleWithKey";
import { cn } from "../../utils/cnHelper";
import { formatYouTubeDuration } from "../../utils/youtubeSearch";

type ServicePlanSetlistProps = {
  sections: ServicePlanSection[] | null | undefined;
  songs: DBItem[];
  resolvedSongRefs: ReadonlyMap<string, ServicePlanSongReference[]>;
  onViewSong: (songRef: ServicePlanSongReference) => void;
  onCreatePendingSong?: (
    songRef: Extract<ServicePlanSongReference, { kind: "pending" }>,
  ) => void;
  onLinkYouTubeVideo?: (
    song: DBItem,
    result: YouTubeSearchResult,
  ) => void | Promise<void>;
};

const songRefName = (
  songRef: ServicePlanSongReference,
  song?: DBItem,
) => {
  const key = songRef.key?.trim() || song?.songMetadata?.key?.trim();
  return getServicePlanSongRefLabel(
    key && key !== songRef.key ? { ...songRef, key } : songRef,
  );
};

const ServicePlanSetlist = ({
  sections,
  songs,
  resolvedSongRefs,
  onViewSong,
  onCreatePendingSong,
  onLinkYouTubeVideo,
}: ServicePlanSetlistProps) => {
  const { churchId } = useContext(GlobalInfoContext) || {};
  const playerRef = useRef<YouTubePlaylistPlayerHandle>(null);
  const [pickerEntryKey, setPickerEntryKey] = useState<string | null>(null);
  const [unavailableEntryKeys, setUnavailableEntryKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [currentEntryKey, setCurrentEntryKey] = useState<string | null>(null);
  const entries = useMemo(() => {
    const songsById = new Map(songs.map((song) => [song._id, song]));
    return (sections ?? []).flatMap((section) =>
      section.elements.flatMap((element) => {
        const songRefs =
          resolvedSongRefs.get(element.id) ??
          getServicePlanElementSongRefs(element);
        return songRefs.map((songRef, songIndex) => ({
          key: `${element.id}:${songIndex}`,
          songRef,
          song:
            songRef.kind === "library"
              ? songsById.get(songRef.songId)
              : undefined,
        }));
      }),
    );
  }, [resolvedSongRefs, sections, songs]);

  const playlistQueue = useMemo(
    () => buildYouTubePlaylistQueue(entries.map(({ key, song }) => ({ key, song }))),
    [entries],
  );
  const playableCount = playlistQueue.filter(
    (entry) => !unavailableEntryKeys.has(entry.entryKey),
  ).length;
  const knownDurationCount = playlistQueue.filter(
    (entry) => entry.durationSeconds !== undefined,
  ).length;
  const playlistDuration = playlistQueue.reduce(
    (total, entry) => total + (entry.durationSeconds ?? 0),
    0,
  );
  const pickerEntry = entries.find((entry) => entry.key === pickerEntryKey);

  if (!entries.length) {
    return (
      <div className="flex min-h-40 flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-gray-700 bg-black/20 p-5 text-center">
        <Music2 className="mb-2 size-6 text-gray-500" aria-hidden />
        <p className="text-sm font-medium text-gray-200">No songs yet</p>
        <p className="mt-1 text-xs text-gray-400">
          Songs attached to the order will appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      <section
        className="scrollbar-variable min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-700 bg-black/20"
        aria-label="Service setlist"
      >
      <div className="sticky top-0 z-10 border-b border-gray-700 bg-gray-950/95 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-400">
            {entries.length} {entries.length === 1 ? "song" : "songs"}
          </p>
          <p className="text-xs font-medium text-cyan-200">
            {playableCount} of {entries.length} songs playable
            {knownDurationCount ? ` · ${formatYouTubeDuration(playlistDuration)}` : ""}
          </p>
        </div>
      </div>
      {playlistQueue.length ? (
        <YouTubePlaylistPlayer
          ref={playerRef}
          queue={playlistQueue}
          onVideoUnavailable={(entry) =>
            setUnavailableEntryKeys((keys) => new Set(keys).add(entry.entryKey))
          }
          onCurrentEntryChange={setCurrentEntryKey}
        />
      ) : null}
      <ol className="divide-y divide-gray-800">
        {entries.map(({ key, songRef, song }, index) => {
          const youtubeLink = getFirstYouTubeLink(song);
          const isUnavailable = unavailableEntryKeys.has(key);
          const isCurrent = currentEntryKey === key;
          return (
          <li
            key={key}
            aria-current={isCurrent ? "true" : undefined}
            className={cn(
              "flex flex-col gap-1.5 px-2.5 py-2 sm:px-3",
              isCurrent && "bg-cyan-950/30",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="w-5 shrink-0 text-right text-xs tabular-nums text-gray-500"
                aria-hidden
              >
                {index + 1}
              </span>
              <Button
                type="button"
                variant="tertiary"
                className="min-w-0 flex-1 max-md:min-h-0"
                padding="px-1 py-0.5"
                aria-label={
                  songRef.kind === "pending" && onCreatePendingSong
                    ? `Create ${songRefName(songRef, song)} in the library`
                    : songRef.kind === "pending"
                      ? `View reference lyrics for ${songRefName(songRef, song)}`
                      : `View song details for ${songRefName(songRef, song)}`
                }
                onClick={() => {
                  if (songRef.kind === "pending" && onCreatePendingSong) {
                    onCreatePendingSong(songRef);
                    return;
                  }
                  onViewSong(songRef);
                }}
              >
                <span className="truncate text-left text-sm text-gray-100">
                  {songRefName(songRef, song) || "Untitled song"}
                </span>
              </Button>
              {!song ? (
                <span className="shrink-0 text-[11px] text-amber-300">
                  {songRef.kind === "pending" && onCreatePendingSong
                    ? "Not in library · Create"
                    : "Not in library"}
                </span>
              ) : null}
              {song && youtubeLink ? (
                <Button
                  type="button"
                  variant="tertiary"
                  padding="px-1.5 py-1"
                  className="shrink-0 text-xs max-md:min-h-0"
                  aria-label={`Play ${song.name}`}
                  onClick={() => playerRef.current?.playEntry(key)}
                >
                  <Play className="size-3.5" aria-hidden />
                </Button>
              ) : null}
              {isUnavailable ? (
                <span className="shrink-0 text-[11px] text-amber-300">Unavailable</span>
              ) : null}
              {youtubeLink?.durationSeconds !== undefined ? (
                <span className="shrink-0 text-xs tabular-nums text-gray-500">
                  {formatYouTubeDuration(youtubeLink.durationSeconds)}
                </span>
              ) : null}
              {song && onLinkYouTubeVideo ? (
                <Button
                  type="button"
                  variant="textLink"
                  svg={Search}
                  padding="px-1 py-0.5"
                  className="shrink-0 text-xs text-cyan-200 max-md:min-h-0"
                  onClick={() => setPickerEntryKey(key)}
                >
                  {youtubeLink ? "Find/replace" : "Find video"}
                </Button>
              ) : null}
            </div>

            {song?.songLinks?.length || song?.songAudio ? (
              <div className="ml-7 flex min-w-0 flex-wrap items-center gap-1.5">
                {song.songLinks?.map((link) => (
                  <SongLinkPreview key={link.id} link={link} compact />
                ))}
                {song.songAudio && churchId ? (
                  <SongAudioPlayer
                    audio={song.songAudio}
                    compact
                    showFileDetails={false}
                    showDownload={false}
                    className="border-0 bg-transparent p-0"
                    onGetUrl={async (disposition) => {
                      const result = await getSongAudioUrl({
                        churchId,
                        songId: song._id,
                        audio: song.songAudio!,
                        disposition,
                      });
                      return result.url;
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </li>
          );
        })}
      </ol>
      </section>
      {pickerEntry?.song && onLinkYouTubeVideo ? (
        <YouTubeVideoPicker
          isOpen
          onClose={() => setPickerEntryKey(null)}
          title={pickerEntry.song.name}
          artist={pickerEntry.song.songMetadata?.artistName}
          album={pickerEntry.song.songMetadata?.albumName}
          onSelect={async (result) => {
            await onLinkYouTubeVideo(pickerEntry.song!, result);
            setUnavailableEntryKeys((keys) => {
              const next = new Set(keys);
              next.delete(pickerEntry.key);
              return next;
            });
          }}
        />
      ) : null}
    </>
  );
};

export default ServicePlanSetlist;
