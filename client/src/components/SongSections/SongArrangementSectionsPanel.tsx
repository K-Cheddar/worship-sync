import Select from "../Select/Select";
import SongSectionLyricCard from "./SongSectionLyricCard";
import { SongSectionLyricCardMode } from "./SongSectionLyricCard";
import { DBItem, FormattedLyrics } from "../../types";

const EMPTY_SECTIONS: FormattedLyrics[] = [];

export const getSongArrangementLabel = (name: string | undefined, index: number) =>
  name?.trim() || `Arrangement ${index + 1}`;

export type SongArrangementSectionsPanelProps = {
  song: DBItem;
  mode: SongSectionLyricCardMode;
  arrangementIndex: number;
  onArrangementIndexChange: (index: number) => void;
  searchHighlight?: string;
  arrangementSelectId: string;
  selectedSectionIds?: string[];
  onToggleSection?: (sectionId: string) => void;
};

const SongArrangementSectionsPanel = ({
  song,
  mode,
  arrangementIndex,
  onArrangementIndexChange,
  searchHighlight,
  arrangementSelectId,
  selectedSectionIds = [],
  onToggleSection,
}: SongArrangementSectionsPanelProps) => {
  const arrangements = song.arrangements || [];
  const selectedArrangement = arrangements[arrangementIndex];
  const rawSections = selectedArrangement?.formattedLyrics;
  const arrangementSections = Array.isArray(rawSections)
    ? rawSections
    : EMPTY_SECTIONS;

  if (arrangements.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        This song does not have any arrangements yet.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="shrink-0">
        <Select
          id={arrangementSelectId}
          label="Arrangement"
          value={String(arrangementIndex)}
          onChange={(value) => {
            onArrangementIndexChange(Number(value));
          }}
          options={arrangements.map((arrangement, index) => ({
            value: String(index),
            label: getSongArrangementLabel(arrangement.name, index),
          }))}
          backgroundColor="bg-gray-700"
          textColor="text-white"
          chevronColor="text-white"
          contentBackgroundColor="bg-gray-800"
          contentTextColor="text-white"
        />
      </div>

      <p className="shrink-0 text-sm text-gray-400">
        <span className="font-medium text-gray-300">Source:</span> {song.name}
      </p>

      {arrangementSections.length === 0 ? (
        <p className="text-sm text-gray-400">
          {mode === "import"
            ? "This arrangement does not have any sections to import."
            : "This arrangement does not have any sections."}
        </p>
      ) : (
        <ul className="scrollbar-variable flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-1">
          {arrangementSections.map((section) => (
            <SongSectionLyricCard
              key={section.id}
              section={section}
              mode={mode}
              isChecked={selectedSectionIds.includes(section.id)}
              onToggle={
                onToggleSection ? () => onToggleSection(section.id) : undefined
              }
              searchHighlight={searchHighlight}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

export default SongArrangementSectionsPanel;
