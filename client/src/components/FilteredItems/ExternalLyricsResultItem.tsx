import { FilePlus, LayoutList } from "lucide-react";

import Button from "../Button/Button";
import HighlightWords from "./HighlightWords";
import { cn } from "../../utils/cnHelper";
import { alternatingAdminListRowBg } from "../../utils/listRowStripes";
import { getLyricsPreviewLines } from "../LyricsImportLyricsPreview/LyricsImportLyricsPreview";
import {
  getExternalSectionClassName,
  type ExternalSectionPosition,
} from "./externalResultsSection";
import {
  getImportableLyricsFromTrack,
  type NormalizedLrclibTrack,
} from "../../utils/lrclib";

type ExternalLyricsResultItemProps = {
  index: number;
  candidate: NormalizedLrclibTrack;
  searchValue: string;
  sectionPosition: ExternalSectionPosition | null;
  onCreateSong: (candidate: NormalizedLrclibTrack) => void;
  onViewLyrics: (candidate: NormalizedLrclibTrack) => void;
};

const ExternalLyricsResultItem = ({
  index,
  candidate,
  searchValue,
  sectionPosition,
  onCreateSong,
  onViewLyrics,
}: ExternalLyricsResultItemProps) => {
  const lyricsText = getImportableLyricsFromTrack(candidate);
  const previewText = getLyricsPreviewLines(lyricsText, searchValue, 4);
  const albumLabel = candidate.albumName ? ` • ${candidate.albumName}` : "";

  return (
    <div
      role="listitem"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        alternatingAdminListRowBg(index),
        getExternalSectionClassName(sectionPosition),
      )}
    >
      <div className="flex flex-col gap-2 py-1.5 pl-4 pr-2 md:flex-row md:items-center md:gap-2 md:pr-2">
        <div className="flex w-full min-w-0 items-start justify-between gap-2 md:flex-1 md:justify-start md:pr-0">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <HighlightWords
                searchValue={searchValue}
                string={candidate.trackName}
                className="text-base"
                highlightWordColor="text-orange-400"
                nonHighlightWordColor="text-white"
                allowPartial
              />
              <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/95">
                {candidate.source === "genius" ? "Genius" : "LRCLIB"}
              </span>
            </div>
            <p
              className="truncate text-sm text-gray-400"
              title={`${candidate.artistName}${albumLabel}`}
            >
              {candidate.artistName}
              {albumLabel}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:ml-auto md:flex-nowrap">
          {lyricsText.trim() ? (
            <Button
              type="button"
              onClick={() => onViewLyrics(candidate)}
              svg={LayoutList}
              variant="tertiary"
              color="#22d3ee"
              aria-label="View lyrics"
            >
              View lyrics
            </Button>
          ) : null}
          <Button
            variant="secondary"
            className="min-h-6 text-sm leading-3"
            padding="py-1 px-2"
            svg={FilePlus}
            color="#84cc16"
            onClick={() => onCreateSong(candidate)}
          >
            Create song
          </Button>
        </div>
      </div>
      {previewText ? (
        <HighlightWords
          searchValue={searchValue}
          string={previewText}
          className="max-h-32 overflow-y-auto border-t-2 border-white/10 px-4 py-2 text-sm text-gray-300 whitespace-pre-wrap"
        />
      ) : null}
    </div>
  );
};

export default ExternalLyricsResultItem;
