import { useEffect, useMemo, useState } from "react";
import { Music, X } from "lucide-react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import TextArea from "../../components/TextArea/TextArea";
import { useSelector } from "../../hooks";
import { useServicePlanSongLibrary } from "./useServicePlanSongLibrary";
import { filterAndSortItemsForSearch, prepareItemSearchDocuments } from "../../utils/songSearchUtils";
import {
  getServicePlanSongRefLabel,
  libraryServicePlanSongRef,
} from "../../integrations/servicePlanning/formatSongTitleWithKey";
import type { ServicePlanSongReference } from "../../types/servicePlan";

type SongReferencePickerProps = {
  value?: ServicePlanSongReference;
  onChange: (value: ServicePlanSongReference | undefined) => void;
  disabled?: boolean;
};

const MAX_SEARCH_RESULTS = 8;

/**
 * Lets an element reference a real song from the presentation-controller
 * library, or capture a not-yet-created song as a title + pasted lyrics —
 * the operator resolves that into a real song doc later, reusing the
 * existing lyrics-paste pipeline (client/src/utils/itemUtil.ts:
 * createSections/createNewSong), which this deliberately doesn't duplicate.
 */
const SongReferencePicker = ({ value, onChange, disabled }: SongReferencePickerProps) => {
  const allSongDocs = useSelector((state) => state.allDocs.allSongDocs);
  const { songs } = useServicePlanSongLibrary();
  const searchDocuments = useMemo(() => {
    prepareItemSearchDocuments(allSongDocs);
    return allSongDocs;
  }, [allSongDocs]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timeout);
  }, [query]);
  const [pendingTitle, setPendingTitle] = useState(
    value?.kind === "pending" ? value.title : "",
  );
  const [pendingLyrics, setPendingLyrics] = useState(
    value?.kind === "pending" ? value.lyricsText : "",
  );

  const results = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    return filterAndSortItemsForSearch(songs, searchDocuments, debouncedQuery, "song")
      .slice(0, MAX_SEARCH_RESULTS);
  }, [songs, searchDocuments, debouncedQuery]);

  if (value?.kind === "library") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-gray-700 bg-gray-950/60 px-2 py-1.5">
        <Music className="size-4 shrink-0 text-orange-300" aria-hidden />
        <span className="flex-1 truncate text-sm">
          {getServicePlanSongRefLabel(value)}
        </span>
        <Button
          type="button"
          variant="tertiary"
          iconSize="sm"
          svg={X}
          aria-label="Clear song reference"
          disabled={disabled}
          onClick={() => onChange(undefined)}
        />
      </div>
    );
  }

  if (value?.kind === "pending") {
    return (
      <div className="space-y-2 rounded-md border border-gray-700 bg-gray-950/60 p-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-amber-200">
            Not in the song library yet
          </p>
          <Button
            type="button"
            variant="tertiary"
            iconSize="sm"
            svg={X}
            aria-label="Clear song reference"
            disabled={disabled}
            onClick={() => onChange(undefined)}
          />
        </div>
        <Input
          label="Song title"
          value={pendingTitle}
          disabled={disabled}
          onChange={(next) => {
            const title = String(next);
            setPendingTitle(title);
            onChange({ kind: "pending", title, lyricsText: pendingLyrics });
          }}
        />
        <TextArea
          label="Lyrics"
          description="The presentation controller operator can create this song from these lyrics later."
          value={pendingLyrics}
          disabled={disabled}
          onChange={(lyricsText) => {
            setPendingLyrics(lyricsText);
            onChange({ kind: "pending", title: pendingTitle, lyricsText });
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Input
        label="Search songs"
        hideLabel
        placeholder="Search the song library…"
        value={query}
        disabled={disabled}
        onChange={(next) => setQuery(String(next))}
      />
      {query !== debouncedQuery ? <p role="status" className="text-xs text-gray-400">Searching…</p> : null}
      {results.length > 0 ? (
        <ul className="space-y-1 rounded-md border border-gray-700 bg-gray-950/60 p-1">
          {results.map((doc) => {
            const songRef = libraryServicePlanSongRef(doc);
            return (
              <li key={doc._id}>
                <Button
                  type="button"
                  variant="tertiary"
                  className="w-full justify-start"
                  onClick={() => {
                    onChange(songRef);
                    setQuery("");
                    setDebouncedQuery("");
                  }}
                >
                  {getServicePlanSongRefLabel(songRef)}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Button
        type="button"
        variant="tertiary"
        disabled={disabled}
        onClick={() => onChange({ kind: "pending", title: "", lyricsText: "" })}
      >
        Song not in the library yet
      </Button>
    </div>
  );
};

export default SongReferencePicker;
