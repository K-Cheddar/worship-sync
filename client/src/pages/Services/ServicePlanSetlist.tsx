import { LoaderCircle, Music2, Pause, Play, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { YouTubeSearchResult } from "../../api/auth";
import Button from "../../components/Button/Button";
import SongLinkPreview from "../../components/SongLinkPreview/SongLinkPreview";
import YouTubeVideoPicker from "../../components/YouTubeVideoPicker/YouTubeVideoPicker";
import { getFirstYouTubeLink } from "../../components/YouTubePlaylistPlayer/youtubePlaylist";
import {
  buildRehearsalPlaybackQueue,
  getRehearsalPlaybackEntryKey,
  type RehearsalPlaybackEntry,
} from "../../components/RehearsalPlayer/rehearsalPlaybackQueue";
import { useRehearsalPlaybackController } from "../../components/RehearsalPlayer/RehearsalPlaybackContext";
import type { DBItem } from "../../types";
import type { ServicePlanSection, ServicePlanSongReference } from "../../types/servicePlan";
import { getServicePlanSongRefLabel } from "../../integrations/servicePlanning/formatSongTitleWithKey";
import { cn } from "../../utils/cnHelper";
import { formatYouTubeDuration } from "../../utils/youtubeSearch";
import {
  buildServicePlanRehearsalEntries,
  getEffectiveServicePlanSongKey,
} from "./servicePlanRehearsal";

type ServicePlanSetlistProps = {
  planKey?: string;
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
  const key = getEffectiveServicePlanSongKey(songRef, song);
  return getServicePlanSongRefLabel(
    key && key !== songRef.key ? { ...songRef, key } : songRef,
  );
};

const addKnownAudioDurations = (
  queue: RehearsalPlaybackEntry[],
  durationByEntryKey: Readonly<Record<string, number>>,
) => queue.map((entry) => {
  const durationSeconds = durationByEntryKey[entry.entryKey];
  if (entry.source.kind !== "audio" || durationSeconds === undefined) return entry;
  return { ...entry, source: { ...entry.source, durationSeconds } };
});

const ServicePlanSetlist = ({
  planKey,
  sections,
  songs,
  resolvedSongRefs,
  onViewSong,
  onCreatePendingSong,
  onLinkYouTubeVideo,
}: ServicePlanSetlistProps) => {
  const { currentEntry, durationByEntryKey, isLoading, isPlaying, playEntry, playQueue, togglePlayback } = useRehearsalPlaybackController();
  const [pickerEntryKey, setPickerEntryKey] = useState<string | null>(null);
  const entries = useMemo(
    () => buildServicePlanRehearsalEntries(sections, songs, resolvedSongRefs),
    [resolvedSongRefs, sections, songs],
  );

  const playlistQueue = useMemo(
    () => addKnownAudioDurations(buildRehearsalPlaybackQueue(entries, undefined, planKey), durationByEntryKey),
    [durationByEntryKey, entries, planKey],
  );
  const playableCount = playlistQueue.length;
  const knownDurationCount = playlistQueue.filter(
    (entry) => entry.source.durationSeconds !== undefined,
  ).length;
  const playlistDuration = playlistQueue.reduce(
    (total, entry) => total + (entry.source.durationSeconds ?? 0),
    0,
  );
  const totalPlanUses = entries.reduce((total, entry) => total + entry.usageCount, 0);
  const playlistEntriesByKey = new Map(
    playlistQueue.map((entry) => [entry.entryKey, entry]),
  );
  const pickerEntry = entries.find((entry) => entry.key === pickerEntryKey);

  if (!entries.length) {
    return (
      <div className="flex min-h-40 flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-gray-700 bg-black/20 p-5 text-center">
        <Music2 className="mb-2 size-6 text-gray-500" aria-hidden />
        <p className="text-sm font-medium text-gray-200">No songs to rehearse yet</p>
        <p className="mt-1 text-xs text-gray-400">
          Songs in the Plan will appear here when they’re ready to rehearse.
        </p>
      </div>
    );
  }

  return (
    <>
      <section
        className="scrollbar-variable min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-700 bg-black/20"
        aria-label="Rehearse songs"
      >
      <div className="sticky top-0 z-10 border-b border-gray-700 bg-gray-950/95 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-400">
            {entries.length} {entries.length === 1 ? "song" : "songs"}
            {totalPlanUses > entries.length
              ? ` · ${totalPlanUses} uses in plan`
              : ""}
          </p>
          <p className="text-xs font-medium text-cyan-200">
            {playableCount} of {entries.length} playable
            {knownDurationCount === playlistQueue.length && playlistQueue.length > 0
              ? ` · ${formatYouTubeDuration(playlistDuration)}`
              : ""}
          </p>
          <Button
            type="button"
            variant="cta"
            svg={Play}
            padding="px-2 py-1"
            className="min-h-9 text-xs max-md:min-h-10"
            disabled={!playlistQueue.length}
            onClick={() => playQueue(playlistQueue)}
          >
            Play All
          </Button>
        </div>
      </div>
      <ol className="divide-y divide-gray-800">
        {entries.map(({ key, songRef, song, usageCount, occurrenceNumbers }, index) => {
          const youtubeLink = getFirstYouTubeLink(song);
          const playbackEntryKey = getRehearsalPlaybackEntryKey(key, planKey);
          const playlistEntry = playlistEntriesByKey.get(playbackEntryKey);
          const isCurrent = currentEntry?.entryKey === playbackEntryKey && currentEntry.songId === song?._id;
          const isCurrentLoading = isCurrent && isLoading;
          const isRowPlaying = isCurrent && isPlaying;
          let PlayIcon = Play;
          let playButtonLabel = `Play ${song?.name}`;
          if (isCurrentLoading) {
            PlayIcon = LoaderCircle;
            playButtonLabel = `Loading ${song?.name}`;
          } else if (isRowPlaying) {
            PlayIcon = Pause;
            playButtonLabel = `Pause ${song?.name}`;
          }
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
              {usageCount > 1 ? (
                <span
                  role="note"
                  className="shrink-0 text-[11px] text-gray-500"
                  aria-label={`Used ${usageCount} times in plan at ${occurrenceNumbers.map((number) => `number ${number}`).join(", ")}`}
                  title={`Used at ${occurrenceNumbers.map((number) => `#${number}`).join(", ")}`}
                >
                  Used {usageCount}× in plan
                </span>
              ) : null}
              {!song ? (
                <span className="shrink-0 text-[11px] text-amber-300">
                  {songRef.kind === "pending" && onCreatePendingSong
                    ? "Not in library · Create"
                    : "Not in library"}
                </span>
              ) : null}
              {playlistEntry ? (
                <Button
                  type="button"
                  variant="tertiary"
                  padding="px-1.5 py-1"
                  className="min-h-9 shrink-0 text-xs max-md:min-h-10"
                  aria-label={playButtonLabel}
                  disabled={isCurrentLoading}
                  onClick={() => {
                    if (isCurrent) togglePlayback();
                    else playEntry(playlistQueue, playbackEntryKey);
                  }}
                >
                  <PlayIcon className={cn("size-4", isCurrentLoading && "animate-spin")} aria-hidden />
                </Button>
              ) : null}
              {isCurrent ? <span role="status" className="shrink-0 text-[11px] text-cyan-200">{isLoading ? "Loading" : isPlaying ? "Playing" : "Paused"}</span> : null}
              {song?.songAudio && playlistEntry?.source.kind === "youtube" ? (
                <Button
                  type="button"
                  variant="tertiary"
                  padding="px-2 py-1"
                  className="min-h-9 shrink-0 text-xs max-md:min-h-10"
                  aria-label={`Play MP3 for ${song.name}`}
                  onClick={() => {
                    const audioQueue = addKnownAudioDurations(
                      buildRehearsalPlaybackQueue(entries, key, planKey),
                      durationByEntryKey,
                    );
                    playEntry(audioQueue, playbackEntryKey);
                  }}
                >
                  Play MP3
                </Button>
              ) : null}
              {playlistEntry?.source.durationSeconds !== undefined ? (
                <span className="shrink-0 text-xs tabular-nums text-gray-500">
                  {formatYouTubeDuration(playlistEntry.source.durationSeconds)}
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

            {song?.songLinks?.length ? (
              <div className="ml-7 flex min-w-0 flex-wrap items-center gap-1.5">
                {song.songLinks?.map((link) => (
                  <SongLinkPreview key={link.id} link={link} compact />
                ))}
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
          }}
        />
      ) : null}
    </>
  );
};

export default ServicePlanSetlist;
