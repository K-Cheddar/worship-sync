import { useEffect, useMemo, useRef, useState } from "react";
import { Import, WholeWord, X } from "lucide-react";
import Drawer from "../../components/Drawer";
import Button from "../../components/Button/Button";
import HighlightWords from "../../components/FilteredItems/HighlightWords";
import SongArrangementSectionsPanel, {
  getSongArrangementLabel,
} from "../../components/SongSections/SongArrangementSectionsPanel";
import SongListScrollArea from "../../components/SongList/SongListScrollArea";
import SongSearchInput from "../../components/SongList/SongSearchInput";
import { SectionTabs } from "../../components/SectionTabs/SectionTabs";
import { useSongSearchPagedList } from "../../hooks/useSongSearchPagedList";
import { cn } from "../../utils/cnHelper";
import { alternatingAdminListRowBg } from "../../utils/listRowStripes";
import { SongSearchRow } from "../../utils/songSearchUtils";
import { DBItem, FormattedLyrics } from "../../types";

type AddSongSectionsDrawerProps = {
  songs: DBItem[];
  isOpen: boolean;
  isMobile: boolean;
  isLoading?: boolean;
  currentSongId?: string;
  onImport: (sections: FormattedLyrics[]) => void;
  onClose: () => void;
};

type DrawerTab = "songs" | "sections";

const EMPTY_ARRANGEMENTS: DBItem["arrangements"] = [];
const EMPTY_SECTIONS: FormattedLyrics[] = [];

const MAX_SECTION_NAMES_INLINE = 8;

const formatSectionNamesBrief = (sections: FormattedLyrics[]) => {
  const labels = sections.map(
    (s) => s.name?.trim() || s.type || "Untitled section",
  );
  if (labels.length <= MAX_SECTION_NAMES_INLINE) {
    return labels.join(", ");
  }
  const shown = labels.slice(0, MAX_SECTION_NAMES_INLINE).join(", ");
  const rest = labels.length - MAX_SECTION_NAMES_INLINE;
  return `${shown} (+${rest} more)`;
};

const getArtistName = (song: DBItem) => song.songMetadata?.artistName?.trim() || "";

const SongPickerRow = ({
  row,
  index,
  searchValue,
  selectedSongId,
  currentSongId,
  onSelectSong,
}: {
  row: SongSearchRow;
  index: number;
  searchValue: string;
  selectedSongId: string | null;
  currentSongId?: string;
  onSelectSong: (songId: string) => void;
}) => {
  const { song, matchedWords, showWords: defaultShowLyrics } = row;
  const [showLyrics, setShowLyrics] = useState(defaultShowLyrics);

  useEffect(() => {
    setShowLyrics(defaultShowLyrics);
  }, [song._id, defaultShowLyrics]);

  const artistName = getArtistName(song);
  const isSelected = song._id === selectedSongId;
  const isCurrentSong = song._id === currentSongId;
  const showWordsSection = showLyrics && Boolean(matchedWords);

  return (
    <li>
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-lg border border-white/5 transition-colors",
          alternatingAdminListRowBg(index),
          isSelected
            ? "border-cyan-500 ring-1 ring-cyan-500/30"
            : "hover:border-white/20",
        )}
      >
        <div className="flex items-center gap-2 py-1.5 pl-4">
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 text-left"
            onClick={() => onSelectSong(song._id)}
          >
            <HighlightWords
              searchValue={searchValue}
              string={song.name}
              className="text-base"
              highlightWordColor={showLyrics ? "text-white" : "text-orange-400"}
              nonHighlightWordColor={
                searchValue ? "text-gray-300" : "text-white"
              }
              allowPartial
            />
            {artistName ? (
              <p className="truncate text-sm text-gray-400" title={artistName}>
                {artistName}
              </p>
            ) : null}
          </button>
          <div className="flex shrink-0 items-center gap-2 pr-2">
            {isCurrentSong && (
              <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-200">
                Current song
              </span>
            )}
            {matchedWords ? (
              <Button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowLyrics(!showLyrics);
                }}
                svg={WholeWord}
                color="#fb923c"
                variant="tertiary"
              />
            ) : null}
          </div>
        </div>
        <div>
          <HighlightWords
            searchValue={searchValue}
            string={matchedWords || ""}
            className={cn(
              "px-4 text-sm text-gray-300 transition-all",
              showWordsSection
                ? "max-h-32 overflow-y-auto border-t-2 border-white/10 py-2"
                : "max-h-0",
            )}
          />
        </div>
      </div>
    </li>
  );
};

const AddSongSectionsDrawer = ({
  songs,
  isOpen,
  isMobile,
  isLoading = false,
  currentSongId,
  onImport,
  onClose,
}: AddSongSectionsDrawerProps) => {
  const [activeTab, setActiveTab] = useState<DrawerTab>("songs");
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [selectedArrangementIndex, setSelectedArrangementIndex] = useState<number>(0);
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const previousSelectedSongIdRef = useRef<string | null>(null);

  const songSearch = useSongSearchPagedList({
    songs,
    loadMoreEnabledBase: isOpen && activeTab === "songs" && !isLoading,
    rescheduleKey: `${isOpen}-${activeTab}`,
    isActive: isOpen,
  });

  const {
    searchValue,
    setSearchValue,
    debouncedSearchValue,
    songDocs,
    filteredSongs,
    visibleSongRows,
    listScrollRef,
    isSearchLoading,
    isListFullyLoaded,
  } = songSearch;

  const selectedSong = useMemo(
    () => songDocs.find((song) => song._id === selectedSongId) || null,
    [selectedSongId, songDocs],
  );

  const selectedSongArrangements = selectedSong?.arrangements || EMPTY_ARRANGEMENTS;
  const selectedArrangement =
    selectedSongArrangements[selectedArrangementIndex] || null;
  const arrangementSections = useMemo(() => {
    const lyrics = selectedArrangement?.formattedLyrics;
    return Array.isArray(lyrics) ? lyrics : EMPTY_SECTIONS;
  }, [selectedArrangement]);

  const sectionsToImport = useMemo(
    () =>
      arrangementSections.filter((section) =>
        selectedSectionIds.includes(section.id),
      ),
    [arrangementSections, selectedSectionIds],
  );

  const importPreviewSectionNames = useMemo(
    () => formatSectionNamesBrief(sectionsToImport),
    [sectionsToImport],
  );

  useEffect(() => {
    if (!selectedSongId || !debouncedSearchValue.trim()) {
      return;
    }
    const stillVisible = filteredSongs.some((s) => s._id === selectedSongId);
    if (!stillVisible) {
      setSelectedSongId(null);
    }
  }, [debouncedSearchValue, filteredSongs, selectedSongId]);

  useEffect(() => {
    if (isOpen) return;

    setSelectedSongId(null);
    setSelectedArrangementIndex(0);
    setSelectedSectionIds([]);
    setActiveTab("songs");
    setIsImporting(false);
  }, [isOpen]);

  useEffect(() => {
    if (!selectedSongId && activeTab === "sections") {
      setActiveTab("songs");
    }
  }, [activeTab, selectedSongId]);

  useEffect(() => {
    if (!selectedSong) {
      previousSelectedSongIdRef.current = null;
      if (selectedArrangementIndex !== 0) {
        setSelectedArrangementIndex(0);
      }
      if (selectedSectionIds.length > 0) {
        setSelectedSectionIds([]);
      }
      return;
    }

    const defaultIndex = Math.min(
      Math.max(selectedSong.selectedArrangement || 0, 0),
      Math.max(0, selectedSongArrangements.length - 1),
    );
    if (previousSelectedSongIdRef.current !== selectedSong._id) {
      previousSelectedSongIdRef.current = selectedSong._id;
      if (selectedArrangementIndex !== defaultIndex) {
        setSelectedArrangementIndex(defaultIndex);
      }
      if (selectedSectionIds.length > 0) {
        setSelectedSectionIds([]);
      }
    }
  }, [
    selectedArrangementIndex,
    selectedSectionIds.length,
    selectedSong,
    selectedSongArrangements.length,
  ]);

  useEffect(() => {
    setSelectedSectionIds((currentIds) => {
      const nextIds = currentIds.filter((id) =>
        arrangementSections.some((section) => section.id === id),
      );
      if (
        nextIds.length === currentIds.length &&
        nextIds.every((id, index) => id === currentIds[index])
      ) {
        return currentIds;
      }
      return nextIds;
    });
  }, [arrangementSections]);

  const selectSongAndShowSections = (songId: string) => {
    setSelectedSongId(songId);
    setActiveTab("sections");
  };

  const toggleSection = (sectionId: string) => {
    setSelectedSectionIds((currentIds) =>
      currentIds.includes(sectionId)
        ? currentIds.filter((id) => id !== sectionId)
        : [...currentIds, sectionId],
    );
  };

  const selectAllSections = () => {
    setSelectedSectionIds(arrangementSections.map((s) => s.id));
  };

  const deselectAllSections = () => {
    setSelectedSectionIds([]);
  };

  const allSectionsSelected =
    arrangementSections.length > 0 &&
    arrangementSections.every((s) => selectedSectionIds.includes(s.id));

  const handleImport = () => {
    if (sectionsToImport.length === 0 || isImporting) {
      return;
    }
    setIsImporting(true);
    // Defer so React can paint loading state before parent runs heavy sync work.
    window.setTimeout(() => {
      try {
        onImport(sectionsToImport);
      } finally {
        setIsImporting(false);
      }
    }, 0);
  };

  const renderSongs = () => {
    if (isLoading) {
      return <p className="text-sm text-gray-400">Songs are loading...</p>;
    }

    if (songDocs.length === 0) {
      return <p className="text-sm text-gray-400">No songs available yet.</p>;
    }

    if (filteredSongs.length === 0) {
      return (
        <p className="text-sm text-gray-400">
          No songs match that search. Try a different title or a phrase from the
          lyrics.
        </p>
      );
    }

    return (
      <SongListScrollArea
        scrollRef={listScrollRef}
        isSearchLoading={isSearchLoading}
        isFullyLoaded={isListFullyLoaded}
        layout="panel"
      >
        {visibleSongRows.map((row, index) => (
          <SongPickerRow
            key={row.song._id}
            row={row}
            index={index}
            searchValue={searchValue}
            selectedSongId={selectedSongId}
            currentSongId={currentSongId}
            onSelectSong={selectSongAndShowSections}
          />
        ))}
      </SongListScrollArea>
    );
  };

  const renderSectionChooser = () => {
    if (!selectedSong) {
      return (
        <p className="text-sm text-gray-400">
          Choose a source song on the Songs tab to preview and import sections.
        </p>
      );
    }

    return (
      <SongArrangementSectionsPanel
        song={selectedSong}
        mode="import"
        arrangementIndex={selectedArrangementIndex}
        onArrangementIndexChange={(index) => {
          setSelectedArrangementIndex(index);
          setSelectedSectionIds([]);
        }}
        searchHighlight={searchValue}
        arrangementSelectId="import-song-arrangement"
        selectedSectionIds={selectedSectionIds}
        onToggleSection={toggleSection}
        allSelected={allSectionsSelected}
        onSelectAll={selectAllSections}
        onDeselectAll={deselectAllSections}
      />
    );
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Import sections from song"
      size="xl"
      position={isMobile ? "bottom" : "right"}
      contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
      contentPadding="p-0"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
        <SectionTabs<DrawerTab>
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 flex-1 flex-col pb-0"
          tabsContentClassName="mt-4 flex min-h-0 flex-1 flex-col gap-0 space-y-0"
          items={[
            {
              value: "songs",
              label: "Songs",
              contentClassName:
                "flex min-h-0 flex-1 flex-col gap-3 data-[state=inactive]:hidden",
              content: (
                <>
                  <SongSearchInput
                    label="Search songs"
                    hideLabel
                    value={searchValue}
                    onChange={setSearchValue}
                  />
                  {renderSongs()}
                </>
              ),
            },
            {
              value: "sections",
              label: "Sections",
              disabled: !selectedSong,
              contentClassName:
                "flex min-h-0 flex-1 flex-col gap-3 data-[state=inactive]:hidden",
              content: renderSectionChooser(),
            },
          ]}
        />

        {selectedSong && sectionsToImport.length > 0 ? (
          <div
            className="shrink-0 rounded-md border border-cyan-500/25 bg-cyan-950/25 px-3 py-2.5"
            aria-live="polite"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-200/90">
              Ready to import
            </p>
            <p className="mt-1 text-sm font-medium text-gray-100">
              {selectedSong.name}
            </p>
            {selectedSongArrangements.length > 1 && selectedArrangement ? (
              <p className="mt-0.5 text-xs text-gray-400">
                Arrangement:{" "}
                {getSongArrangementLabel(
                  selectedArrangement.name,
                  selectedArrangementIndex,
                )}
              </p>
            ) : null}
            <p className="mt-2 text-xs leading-snug text-gray-300">
              <span className="font-medium text-gray-400">Sections: </span>
              {importPreviewSectionNames}
            </p>
          </div>
        ) : null}

        <div className="flex shrink-0 justify-end gap-2 border-t border-gray-700 pt-4">
          <Button
            variant="secondary"
            onClick={onClose}
            svg={X}
            disabled={isImporting}
          >
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleImport}
            disabled={sectionsToImport.length === 0 || isImporting}
            isLoading={isImporting}
            aria-busy={isImporting}
            svg={Import}
          >
            {isImporting ? "Importing..." : "Import selected"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
};

export default AddSongSectionsDrawer;
