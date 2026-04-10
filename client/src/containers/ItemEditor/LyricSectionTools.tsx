import { useId, useState } from "react";
import { BookCopy, ChevronDown, Plus } from "lucide-react";
import Button from "../../components/Button/Button";
import Select from "../../components/Select/Select";
import { Switch } from "../../components/ui/Switch";
import { itemSectionBgColorMap, sectionTypes } from "../../utils/slideColorMap";
import cn from "classnames";

type LyricSectionToolsProps = {
  addNewSectionsToSongOrder: boolean;
  onAddNewSectionsToSongOrderChange: (value: boolean) => void;
  onAddEmptySection: (sectionType: string) => void;
  onOpenImportDrawer: () => void;
  /** One-row trigger; full tools show when expanded (use on small screens). */
  collapsible?: boolean;
};

const ADD_SECTION_SELECT_ID = "lyrics-section-tools-add-section-select";

const sectionTypeOptions = sectionTypes.map((type) => ({
  value: type,
  label: type,
  className: cn(
    itemSectionBgColorMap.get(type) ?? "bg-gray-700",
    "text-white rounded px-2 py-0.5 block w-full text-left",
  ),
}));

const LyricSectionTools = ({
  addNewSectionsToSongOrder,
  onAddNewSectionsToSongOrderChange,
  onAddEmptySection,
  onOpenImportDrawer,
  collapsible = false,
}: LyricSectionToolsProps) => {
  /** Remount Radix Select after each add so the same section type can be chosen again. */
  const [addSectionSelectKey, setAddSectionSelectKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const songOrderToggleId = useId();
  const songOrderDescriptionId = `${songOrderToggleId}-description`;
  const expandablePanelId = useId();

  const handleAddSection = (sectionType: string) => {
    if (!sectionType) return;
    onAddEmptySection(sectionType);
    setAddSectionSelectKey((k) => k + 1);
  };

  const orderToggleAndActions = (
    <>
      <div className="rounded-lg border border-white/10 bg-gray-950/70 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor={songOrderToggleId}
            className="cursor-pointer text-sm font-medium text-gray-100"
          >
            Add to Song Order
          </label>
          <Switch
            id={songOrderToggleId}
            checked={addNewSectionsToSongOrder}
            onCheckedChange={onAddNewSectionsToSongOrderChange}
            aria-describedby={songOrderDescriptionId}
          />
        </div>
        <p
          id={songOrderDescriptionId}
          className="mt-2 text-xs leading-snug text-gray-400"
        >
          {addNewSectionsToSongOrder
            ? "New sections are appended to the song order automatically."
            : "New sections are not added to the song order until you add them."}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Select
          key={addSectionSelectKey}
          onChange={handleAddSection}
          value=""
          suppressCloseAutoFocus
          options={sectionTypeOptions}
          className="sr-only"
          id={ADD_SECTION_SELECT_ID}
          hideLabel
          label="Add empty section"
          backgroundColor="bg-black/40"
          textColor="text-white"
          chevronColor="text-white"
          contentBackgroundColor="bg-gray-800"
          contentTextColor="text-white"
        />
        <Button
          onClick={() => {
            const trigger = document.getElementById(ADD_SECTION_SELECT_ID);
            if (trigger instanceof HTMLButtonElement) {
              trigger.click();
            }
          }}
          variant="tertiary"
          svg={Plus}
          color="#22d3ee"
          className="w-full justify-center rounded-md border border-gray-500"
          aria-label="Add empty section"
        >
          Add empty section
        </Button>
        <Button
          onClick={onOpenImportDrawer}
          variant="primary"
          svg={BookCopy}
          color="#22d3ee"
          className="w-full justify-center rounded-md border border-gray-500"
        >
          Import from song
        </Button>
      </div>
    </>
  );

  if (collapsible) {
    return (
      <div className="shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/35 shadow-sm">
        <button
          type="button"
          className="flex min-h-12 w-full touch-manipulation items-center justify-between gap-2 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
          aria-expanded={expanded}
          aria-controls={expandablePanelId}
          onClick={() => setExpanded((open) => !open)}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-gray-100">
              Section tools
            </span>
            <span className="block truncate text-xs text-gray-400">
              {expanded
                ? "Tap to hide"
                : "Add sections, import, song order"}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "size-5 shrink-0 text-gray-300 transition-transform duration-200",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
        </button>
        {expanded ? (
          <div
            id={expandablePanelId}
            className="flex flex-col gap-3 border-t border-white/10 p-3"
          >
            <p className="text-xs text-gray-400">
              Add blank sections or import from another song.
            </p>
            {orderToggleAndActions}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col gap-3 rounded-xl border border-white/10 bg-black/35 p-3 shadow-sm">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-100">Section tools</p>
        <p className="text-xs text-gray-400">
          Add blank sections or import from another song.
        </p>
      </div>

      {orderToggleAndActions}
    </div>
  );
};

export default LyricSectionTools;
