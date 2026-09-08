import { useId, useRef, useState } from "react";
import { BookCopy, ChevronDown, Layers, Plus } from "lucide-react";
import Button from "../../components/Button/Button";
import { Switch } from "../../components/ui/Switch";
import { itemSectionBgColorMap, sectionTypes } from "../../utils/slideColorMap";
import { sortList } from "../../utils/sort";
import cn from "classnames";
import FloatingWindow, { FloatingWindowHandle } from "../../components/FloatingWindow/FloatingWindow";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/Popover";
import RemoveParentheticalsToggle from "../../components/RemoveParentheticalsToggle/RemoveParentheticalsToggle";
import TextArea from "../../components/TextArea/TextArea";
import { removeParentheticalPhrases } from "../../utils/itemUtil";

type LyricSectionToolsProps = {
  addNewSectionsToSongOrder: boolean;
  onAddNewSectionsToSongOrderChange: (value: boolean) => void;
  onAddEmptySection: (sectionType: string) => void;
  onOpenImportDrawer: () => void;
  onAddMultipleSections: (text: string) => void;
  /** One-row trigger; full tools show when expanded (use on small screens). */
  collapsible?: boolean;
};

const sectionTypeOptions = sortList(sectionTypes).map((type) => ({
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
  onAddMultipleSections,
  collapsible = false,
}: LyricSectionToolsProps) => {
  const [addSectionPopoverOpen, setAddSectionPopoverOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [multipleSectionsOpen, setMultipleSectionsOpen] = useState(false);
  const [multipleSectionsPosition, setMultipleSectionsPosition] = useState<{ x: number; y: number } | undefined>();
  const [multipleLyricsText, setMultipleLyricsText] = useState("");
  const [removeParentheticals, setRemoveParentheticals] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addMultipleButtonRef = useRef<HTMLButtonElement>(null);
  const floatingWindowRef = useRef<FloatingWindowHandle>(null);
  const songOrderToggleId = useId();
  const songOrderDescriptionId = `${songOrderToggleId}-description`;
  const expandablePanelId = useId();

  const handleAddMultipleSections = () => {
    if (!multipleLyricsText.trim()) return;
    const text = removeParentheticals
      ? removeParentheticalPhrases(multipleLyricsText)
      : multipleLyricsText;
    onAddMultipleSections(text);
    setMultipleLyricsText("");
    setRemoveParentheticals(false);
    setMultipleSectionsOpen(false);
  };

  const handleAddSection = (sectionType: string) => {
    if (!sectionType) return;
    onAddEmptySection(sectionType);
    setAddSectionPopoverOpen(false);
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
        <Popover
          open={addSectionPopoverOpen}
          onOpenChange={setAddSectionPopoverOpen}
          modal={false}
        >
          <PopoverTrigger asChild>
            <Button
              variant="tertiary"
              svg={Plus}
              color="#22d3ee"
              className="w-full justify-center rounded-md border border-gray-500"
              aria-label="Add empty section"
            >
              Add empty section
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={8}
            className="w-48 border border-gray-600 bg-gray-800 p-2 text-white shadow-lg"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <div className="flex flex-col gap-1">
              {sectionTypeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "cursor-pointer rounded px-2 py-1.5 text-left text-sm text-white hover:brightness-110",
                    option.className,
                  )}
                  onClick={() => handleAddSection(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button
          ref={addMultipleButtonRef}
          variant="tertiary"
          svg={Layers}
          color="#22d3ee"
          className="w-full justify-center rounded-md border border-gray-500"
          onClick={() => {
            if (multipleSectionsOpen) {
              floatingWindowRef.current?.restore();
              return;
            }
            const rect = addMultipleButtonRef.current?.getBoundingClientRect();
            if (rect) {
              const windowWidth = 360;
              setMultipleSectionsPosition({
                x: Math.min(rect.right + 8, window.innerWidth - windowWidth - 8),
                y: rect.top,
              });
            }
            setMultipleSectionsOpen(true);
          }}
        >
          Add lyric sections
        </Button>
        {multipleSectionsOpen && (
          <FloatingWindow
            ref={floatingWindowRef}
            title="Create sections from lyrics"
            onClose={() => {
              setMultipleSectionsOpen(false);
              setMultipleLyricsText("");
              setRemoveParentheticals(false);
            }}
            defaultWidth={360}
            defaultHeight={420}
            defaultPosition={multipleSectionsPosition}
            contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <TextArea
              ref={textareaRef}
              textareaClassName="min-h-0 flex-1 overflow-y-auto rounded-md text-sm"
              className="min-h-0 flex-1"
              label="Lyrics"
              description="Paste lyrics here."
              value={multipleLyricsText}
              onChange={(val) => setMultipleLyricsText(val as string)}
            />
            <RemoveParentheticalsToggle
              className="mt-2 shrink-0"
              value={removeParentheticals}
              onChange={setRemoveParentheticals}
              description='Drops ad-libs like "(Only You)" from the pasted lyrics when sections are added.'
            />
            <Button
              variant="primary"
              className="mt-2 w-full shrink-0 justify-center"
              onClick={handleAddMultipleSections}
              disabled={!multipleLyricsText.trim()}
            >
              Add sections
            </Button>
          </FloatingWindow>
        )}
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
