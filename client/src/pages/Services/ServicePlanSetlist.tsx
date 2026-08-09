import { ExternalLink, Music2 } from "lucide-react";
import { useContext, useMemo } from "react";

import { getSongAudioUrl } from "../../api/auth";
import Button from "../../components/Button/Button";
import SongAudioPlayer from "../../components/SongAudioPlayer/SongAudioPlayer";
import { GlobalInfoContext } from "../../context/globalInfo";
import type { DBItem } from "../../types";
import {
  getServicePlanElementSongRefs,
  type ServicePlanSection,
  type ServicePlanSongReference,
} from "../../types/servicePlan";

type ServicePlanSetlistProps = {
  sections: ServicePlanSection[] | null | undefined;
  songs: DBItem[];
  resolvedSongRefs: ReadonlyMap<string, ServicePlanSongReference[]>;
  onViewSong: (songRef: ServicePlanSongReference) => void;
  onCreatePendingSong?: (
    songRef: Extract<ServicePlanSongReference, { kind: "pending" }>,
  ) => void;
};

const songRefName = (songRef: ServicePlanSongReference) =>
  songRef.kind === "library" ? songRef.songName : songRef.title;

const ServicePlanSetlist = ({
  sections,
  songs,
  resolvedSongRefs,
  onViewSong,
  onCreatePendingSong,
}: ServicePlanSetlistProps) => {
  const { churchId } = useContext(GlobalInfoContext) || {};
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
    <section
      className="scrollbar-variable min-h-0 flex-1 overflow-y-auto rounded-lg border border-gray-700 bg-black/20"
      aria-label="Service setlist"
    >
      <div className="sticky top-0 z-10 border-b border-gray-700 bg-gray-950/95 px-3 py-2">
        <p className="text-xs font-medium text-gray-400">
          {entries.length} {entries.length === 1 ? "song" : "songs"}
        </p>
      </div>
      <ol className="divide-y divide-gray-800">
        {entries.map(({ key, songRef, song }, index) => (
          <li key={key} className="flex flex-col gap-1.5 px-2.5 py-2 sm:px-3">
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
                    ? `Create ${songRefName(songRef)} in the library`
                    : songRef.kind === "pending"
                      ? `View reference lyrics for ${songRefName(songRef)}`
                      : `View song details for ${songRefName(songRef)}`
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
                  {songRefName(songRef) || "Untitled song"}
                </span>
              </Button>
              {!song ? (
                <span className="shrink-0 text-[11px] text-amber-300">
                  {songRef.kind === "pending" && onCreatePendingSong
                    ? "Not in library · Create"
                    : "Not in library"}
                </span>
              ) : null}
            </div>

            {song?.songLinks?.length || song?.songAudio ? (
              <div className="ml-7 flex min-w-0 flex-wrap items-center gap-1.5">
                {song.songLinks?.map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-44 items-center gap-1 rounded border border-gray-600 bg-gray-800 px-1.5 py-1 text-xs text-cyan-200 hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  >
                    <span className="truncate">{link.label || "Link"}</span>
                    <ExternalLink className="size-3 shrink-0" aria-hidden />
                  </a>
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
        ))}
      </ol>
    </section>
  );
};

export default ServicePlanSetlist;
