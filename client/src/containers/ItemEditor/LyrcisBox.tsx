import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import Button from "../../components/Button/Button";
import Select from "../../components/Select/Select";
import TextArea from "../../components/TextArea/TextArea";
import { itemSectionBgColorMap } from "../../utils/slideColorMap";
import type {
  FormattedLyrics as FormattedLyricsType,
  Option,
} from "../../types";
import cn from "classnames";

export type LyrcisBoxProps = {
  lyric: FormattedLyricsType;
  index: number;
  selected: boolean;
  linked?: boolean;
  justMoved: boolean;
  availableSections: Option[];
  availableSectionsKey: string;
  isMobile: boolean;
  onChangeSectionType: (name: string, index: number) => void;
  onDelete: (index: number) => void;
  onSelect?: (sectionId: string) => void;
  onWordsChange: (index: number, value: string) => void;
  /** When true, move focus into the words editor after mount (e.g. new empty section). */
  focusWordsOnMount?: boolean;
};

const LyrcisBox = memo(
  ({
    lyric,
    index,
    selected,
    linked,
    justMoved,
    availableSections,
    availableSectionsKey,
    isMobile,
    onChangeSectionType,
    onDelete,
    onSelect,
    onWordsChange,
    focusWordsOnMount = false,
  }: LyrcisBoxProps) => {
    const wordsRef = useRef<HTMLTextAreaElement>(null);
    const [sectionPickerOpen, setSectionPickerOpen] = useState(false);

    const valueExists = availableSections.some(
      (option) => option.value === lyric.name
    );
    const displaySectionLabel =
      valueExists && lyric.name ? lyric.name : "Select...";

    useEffect(() => {
      setSectionPickerOpen(false);
    }, [availableSectionsKey]);

    useLayoutEffect(() => {
      if (!focusWordsOnMount) {
        return;
      }
      wordsRef.current?.focus();
    }, [focusWordsOnMount]);

    // Second pass after paint: scroll-into-view / layout can run after useLayoutEffect.
    useEffect(() => {
      if (!focusWordsOnMount) {
        return;
      }
      const frame = requestAnimationFrame(() => {
        wordsRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }, [focusWordsOnMount]);

    const handleSectionChange = (val: string) => {
      onChangeSectionType(val, index);
      setSectionPickerOpen(false);
    };

    return (
      <li
        id={lyric.id ? `lyric-box-${lyric.id}` : undefined}
        className={cn(
          "text-sm border-4 rounded-lg",
          selected ? "border-cyan-500" : linked ? "border-white/50" : "border-transparent",
          justMoved && "section-track-move"
        )}
        style={{
          // Skip layout/paint for boxes outside the scrollport (Chromium; harmless elsewhere).
          contentVisibility: "auto",
          containIntrinsicSize: "auto 280px",
        }}
      >
        <div
          className={cn(
            "flex font-semibold text-sm rounded-t-md px-1 py-0.5",
            itemSectionBgColorMap.get(lyric.type)
          )}
        >
          <div className="min-w-[50%] max-w-full min-h-0 flex-1">
            {!sectionPickerOpen ? (
              <button
                type="button"
                className={cn(
                  "flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-neutral-700 px-1.5 py-1 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none cursor-pointer",
                  "focus-visible:ring-[3px] focus-visible:ring-cyan-500/35",
                  "bg-black/40"
                )}
                aria-label={
                  valueExists && lyric.name
                    ? `Change section: ${lyric.name}`
                    : "Select section type"
                }
                aria-haspopup="listbox"
                aria-expanded={false}
                onClick={() => setSectionPickerOpen(true)}
              >
                <span
                  className={cn(
                    "truncate flex-1 text-center",
                    valueExists ? "text-white" : "text-neutral-400"
                  )}
                >
                  {displaySectionLabel}
                </span>
                <ChevronDown
                  className="max-lg:size-6 size-4 shrink-0 pointer-events-none text-white"
                  aria-hidden
                />
              </button>
            ) : (
              <Select
                open={sectionPickerOpen}
                onOpenChange={setSectionPickerOpen}
                onChange={handleSectionChange}
                value={lyric.name}
                options={availableSections}
                backgroundColor="bg-black/40"
                textColor="text-white"
                chevronColor="text-white"
                contentBackgroundColor="bg-gray-900"
                contentTextColor="text-white"
                className="min-w-[50%] max-w-full"
              />
            )}
          </div>
          <Button
            className="ml-auto"
            variant="tertiary"
            svg={Trash2}
            onClick={() => {
              onDelete(index);
            }}
          />
        </div>
        <div
          onClick={() => lyric.id && onSelect && onSelect(lyric.id)}
          className={cn("cursor-pointer")}
        >
          <TextArea
            ref={wordsRef}
            hideLabel
            className="lg:h-[30vh]"
            data-ignore-undo="true"
            value={lyric.words}
            autoResize={isMobile}
            onChange={(val) => onWordsChange(index, val as string)}
            onFocus={() => lyric.id && onSelect && onSelect(lyric.id)}
          />
        </div>
      </li>
    );
  },
  (prev, next) => {
    return (
      prev.lyric === next.lyric &&
      prev.index === next.index &&
      prev.selected === next.selected &&
      prev.linked === next.linked &&
      prev.justMoved === next.justMoved &&
      prev.isMobile === next.isMobile &&
      prev.availableSectionsKey === next.availableSectionsKey &&
      prev.focusWordsOnMount === next.focusWordsOnMount
    );
  }
);

export default LyrcisBox;
