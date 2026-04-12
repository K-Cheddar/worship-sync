import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import Button from "../Button/Button";

export type LyricsImportLyricsPreviewProps = {
  lyricsText: string;
  emptyLabel?: string;
};

export const LyricsImportLyricsPreview = ({
  lyricsText,
  emptyLabel = "No lyrics preview available.",
}: LyricsImportLyricsPreviewProps) => {
  const [expanded, setExpanded] = useState(false);
  const display = lyricsText.trim() ? lyricsText : emptyLabel;

  return (
    <div className="mt-2 rounded-md bg-neutral-900/90 p-2">
      <p className="mb-1 text-xs font-semibold text-neutral-200">Lyrics Preview</p>
      <div
        className={
          expanded
            ? "max-h-60 overflow-y-auto whitespace-pre-wrap text-xs text-neutral-100 scrollbar-variable"
            : "max-h-24 overflow-hidden whitespace-pre-wrap text-xs text-neutral-200"
        }
      >
        {display}
      </div>
      <div className="mt-2">
        <Button
          variant="tertiary"
          className="text-sm min-h-0 h-auto"
          padding="py-1 pl-0 pr-2"
          iconSize="sm"
          svg={expanded ? ChevronUp : ChevronDown}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Collapse preview" : "Expand preview"}
        </Button>
      </div>
    </div>
  );
};
