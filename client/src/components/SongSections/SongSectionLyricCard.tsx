import HighlightWords from "../FilteredItems/HighlightWords";
import { cn } from "../../utils/cnHelper";
import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import { FormattedLyrics } from "../../types";

export type SongSectionLyricCardMode = "import" | "view";

export type SongSectionLyricCardProps = {
  section: FormattedLyrics;
  mode: SongSectionLyricCardMode;
  isChecked?: boolean;
  onToggle?: () => void;
  searchHighlight?: string;
};

const SongSectionLyricCard = ({
  section,
  mode,
  isChecked = false,
  onToggle,
  searchHighlight,
}: SongSectionLyricCardProps) => {
  const label = section.name?.trim() || section.type || "Untitled section";
  const headerClass = itemSectionBgColorMap.get(section.type) ?? "bg-gray-700";
  const query = searchHighlight?.trim() ?? "";

  const body = (
    <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-gray-600">
      <div
        className={cn(
          "flex items-center px-2 py-1 text-sm font-semibold text-white",
          headerClass,
        )}
      >
        <span className="truncate" title={label}>
          {label}
        </span>
      </div>
      <div
        className="scrollbar-variable max-h-[min(50vh,22rem)] min-h-14 overflow-y-auto border-t border-black/20 bg-gray-950/90 p-3 text-sm leading-relaxed text-gray-100"
      >
        {section.words.trim() ? (
          query ? (
            <HighlightWords
              searchValue={query}
              string={section.words}
              className="leading-relaxed"
              highlightWordColor="text-orange-400"
              nonHighlightWordColor="text-gray-100"
            />
          ) : (
            <span className="whitespace-pre-wrap">{section.words}</span>
          )
        ) : (
          <span className="italic text-gray-500">Empty section</span>
        )}
      </div>
    </div>
  );

  if (mode === "view") {
    return <li className="rounded-lg">{body}</li>;
  }

  return (
    <li
      className={cn(
        "rounded-lg border-2 p-2.5 transition-colors",
        isChecked ? "border-cyan-500" : "border-transparent",
      )}
    >
      <label className="flex cursor-pointer gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 accent-cyan-500"
          checked={isChecked}
          onChange={onToggle}
          aria-label={`Import ${label}`}
        />
        {body}
      </label>
    </li>
  );
};

export default SongSectionLyricCard;
