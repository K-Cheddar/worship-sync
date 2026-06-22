import { X } from "lucide-react";

import Drawer from "../Drawer";
import Button from "../Button/Button";
import HighlightWords from "./HighlightWords";
import {
  getImportableLyricsFromTrack,
  type NormalizedLrclibTrack,
} from "../../utils/lrclib";

type ViewExternalLyricsDrawerProps = {
  candidate: NormalizedLrclibTrack | null;
  isOpen: boolean;
  isMobile: boolean;
  searchHighlight?: string;
  onClose: () => void;
};

const ViewExternalLyricsDrawer = ({
  candidate,
  isOpen,
  isMobile,
  searchHighlight = "",
  onClose,
}: ViewExternalLyricsDrawerProps) => {
  if (!candidate) {
    return null;
  }

  const lyricsText = getImportableLyricsFromTrack(candidate);
  const albumLabel = candidate.albumName ? ` • ${candidate.albumName}` : "";
  const sourceLabel = candidate.source === "genius" ? "Genius" : "LRCLIB";

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Lyrics — ${candidate.trackName}`}
      size="xl"
      position={isMobile ? "bottom" : "right"}
      contentClassName="flex min-h-0 flex-col"
      contentPadding="p-0"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div className="shrink-0 space-y-1 border-b border-gray-700 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold text-white">{candidate.trackName}</p>
            <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/95">
              {sourceLabel}
            </span>
          </div>
          <p className="text-sm text-gray-400">
            {candidate.artistName}
            {albumLabel}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-variable">
          {lyricsText.trim() ? (
            <HighlightWords
              searchValue={searchHighlight}
              string={lyricsText.trim()}
              preserveLineBreaks
              className="text-sm leading-relaxed text-gray-200"
            />
          ) : (
            <p className="text-sm text-gray-400">No lyrics available for this result.</p>
          )}
        </div>
        <div className="flex shrink-0 justify-end border-t border-gray-700 pt-4">
          <Button variant="secondary" onClick={onClose} svg={X}>
            Close
          </Button>
        </div>
      </div>
    </Drawer>
  );
};

export default ViewExternalLyricsDrawer;
