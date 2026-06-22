import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import Button from "../Button/Button";
import HighlightWords from "../FilteredItems/HighlightWords";
import { punctuationRegex } from "../../utils/generalUtils";

export type LyricsImportLyricsPreviewProps = {
  lyricsText: string;
  emptyLabel?: string;
  searchValue?: string;
  maxPreviewLines?: number;
};

const getSearchTerms = (searchValue: string) =>
  searchValue
    .toLowerCase()
    .replace(punctuationRegex, "")
    .split(/\s+/)
    .filter((term) => term.trim().length > 0);

export const getLyricsPreviewLines = (
  lyricsText: string,
  searchValue: string,
  maxPreviewLines: number,
) => {
  const lines = lyricsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return "";
  }

  if (!searchValue.trim()) {
    return lines.slice(0, maxPreviewLines).join("\n");
  }

  const terms = getSearchTerms(searchValue);
  if (terms.length === 0) {
    return lines.slice(0, maxPreviewLines).join("\n");
  }

  const matchIndex = lines.findIndex((line) => {
    const lowerLine = line.toLowerCase();
    return terms.some((term) => lowerLine.includes(term));
  });

  if (matchIndex === -1) {
    return lines.slice(0, maxPreviewLines).join("\n");
  }

  const halfWindow = Math.floor(maxPreviewLines / 2);
  const start = Math.max(0, matchIndex - halfWindow);
  const end = Math.min(lines.length, start + maxPreviewLines);
  return lines.slice(start, end).join("\n");
};

export const LyricsImportLyricsPreview = ({
  lyricsText,
  emptyLabel = "No lyrics preview available.",
  searchValue = "",
  maxPreviewLines = 6,
}: LyricsImportLyricsPreviewProps) => {
  const [expanded, setExpanded] = useState(false);
  let display = emptyLabel;
  if (lyricsText.trim()) {
    display = expanded
      ? lyricsText.trim()
      : getLyricsPreviewLines(lyricsText, searchValue, maxPreviewLines);
  }

  return (
    <div className="mt-2 rounded-md bg-neutral-900/90 p-2">
      <p className="mb-1 text-xs font-semibold text-neutral-200">Lyrics Preview</p>
      <div
        className={
          expanded
            ? "max-h-60 overflow-y-auto text-xs text-neutral-100 scrollbar-variable"
            : "max-h-24 overflow-hidden text-xs text-neutral-200"
        }
      >
        <HighlightWords
          searchValue={searchValue}
          string={display}
          className="whitespace-pre-wrap"
        />
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
