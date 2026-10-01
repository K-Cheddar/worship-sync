import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { cn } from "@/utils/cnHelper";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import Input from "../../components/Input/Input";
import Button from "../../components/Button/Button";
import PositionIconBadge, { getPositionIconColor } from "../../components/icons/PositionIconBadge";
import type { IconCatalogEntry, IconRef, PositionIcon } from "../../components/icons/iconTypes";
import { POSITION_ICON_DEFAULT_COLOR } from "../../components/icons/iconTypes";
import {
  formatPositionIconLabel,
  getLucidePositionIconCatalog,
  loadPositionIconCatalog,
  normalizePositionIcon,
  searchPositionIconCatalog,
} from "../../components/icons/iconRegistry";
import { CompactColorPicker } from "../../components/ColorField/ColorField";
import { useLoadMoreOnScroll } from "../../hooks/useLoadMoreOnScroll";
import { contrastingInkForFill } from "../../utils/richTextColorContrast";

const INITIAL_VISIBLE_COUNT = 60;
const LOAD_MORE_BATCH_SIZE = 60;
const LEGACY_TEAM_ICONS = [
  "Mic", "Mic2", "MicVocal", "Music", "Music2", "Music4", "Guitar", "Piano", "Drum",
  "Speaker", "Headphones", "Volume2", "AudioLines", "AudioWaveform", "Radio", "SlidersHorizontal",
  "Video", "Camera", "Clapperboard", "Projector", "MonitorPlay", "Tv", "Lightbulb", "Sparkles",
  "Presentation", "Captions", "Users", "User", "UserCog", "Hand", "Church", "BookOpen", "Cross", "Heart", "Star", "Wrench",
].map((name) => ({ source: "lucide", name }) as IconRef);

export const RECOMMENDED_GROUPS: Array<{ label: string; icons: IconRef[] }> = [
  {
    label: "Audio",
    icons: [
      { source: "tabler", name: "microphone" },
      { source: "lucide", name: "Headphones" },
      { source: "lucide", name: "Speaker" },
      { source: "lucide", name: "MonitorSpeaker" },
      { source: "lucide", name: "SlidersHorizontal" },
      { source: "lucide", name: "AudioWaveform" },
      { source: "lucide", name: "Cable" },
    ],
  },
  {
    label: "Video & Broadcast",
    icons: [
      { source: "lucide", name: "Camera" },
      { source: "lucide", name: "Video" },
      { source: "tabler", name: "broadcast" },
      { source: "tabler", name: "live-view" },
      { source: "lucide", name: "Projector" },
      { source: "lucide", name: "Tv" },
      { source: "lucide", name: "Presentation" },
    ],
  },
  {
    label: "Lighting",
    icons: [
      { source: "lucide", name: "Spotlight" },
      { source: "lucide", name: "LampCeiling" },
      { source: "lucide", name: "Flashlight" },
    ],
  },
  {
    label: "Music",
    icons: [
      { source: "lucide", name: "Guitar" },
      { source: "lucide", name: "Piano" },
      { source: "lucide", name: "Drum" },
      { source: "lucide", name: "Music" },
      { source: "lucide", name: "MicVocal" },
    ],
  },
  {
    label: "Ministry & Scripture",
    icons: [
      { source: "lucide", name: "Church" },
      { source: "tabler", name: "bible" },
      { source: "tabler", name: "pray" },
      { source: "lucide", name: "Cross" },
      { source: "lucide", name: "HeartHandshake" },
    ],
  },
  {
    label: "People & Communication",
    icons: [
      { source: "lucide", name: "Users" },
      { source: "lucide", name: "Handshake" },
      { source: "lucide", name: "Megaphone" },
      { source: "lucide", name: "MessageCircle" },
      { source: "lucide", name: "Captions" },
      { source: "lucide", name: "Phone" },
    ],
  },
  {
    label: "Technical & Setup",
    icons: [
      { source: "lucide", name: "Computer" },
      { source: "lucide", name: "Toolbox" },
      { source: "lucide", name: "Wrench" },
      { source: "lucide", name: "Settings2" },
      { source: "lucide", name: "Wifi" },
      { source: "lucide", name: "Router" },
      { source: "lucide", name: "Server" },
    ],
  },
];

type PositionIconPickerProps = {
  label?: string;
  legacyOnly?: boolean;
  value: PositionIcon | "";
  onChange: (icon: PositionIcon | "") => void;
};

type IconButtonProps = {
  icon: IconRef;
  label: string;
  selected: boolean;
  onSelect: (icon: IconRef) => void;
};

type IconPreviewStyle = CSSProperties & {
  "--position-icon-preview-fill": string;
  "--position-icon-preview-ink": string;
};

type PickerView = "recommended" | "all";

const IconButton = memo(({ icon, label, selected, onSelect }: IconButtonProps) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-pressed={selected}
    onClick={() => onSelect(icon)}
    className={cn(
      "flex h-9 w-9 items-center justify-center rounded-md border text-gray-100",
      "hover:bg-gray-800",
      selected ? "border-cyan-400 ring-1 ring-cyan-400/60" : "border-gray-700",
    )}
  >
    <PositionIconBadge
      icon={icon}
      preview
      className="h-7 w-7"
      iconClassName="h-5 w-5"
      data-testid="position-icon-tile"
    />
  </button>
));
IconButton.displayName = "PositionIconPickerIconButton";

const iconKey = (icon: PositionIcon | "") => {
  const ref = normalizePositionIcon(icon);
  return ref ? ("name" in ref ? `${ref.source}:${ref.name}` : `${ref.source}:${ref.id}`) : "";
};

const iconLabel = (ref: IconRef) => formatPositionIconLabel("name" in ref ? ref.name : ref.id);

const recommendedEntry = (group: { label: string; icons: IconRef[] }): IconCatalogEntry[] =>
  group.icons.map((ref) => ({
    ref,
    label: iconLabel(ref),
    searchTerms: [group.label],
  }));

const PositionIconPicker = ({ label = "Icon", legacyOnly = false, value, onChange }: PositionIconPickerProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<PickerView>("recommended");
  const [lucideCatalog, setLucideCatalog] = useState<IconCatalogEntry[] | null>(null);
  const [allCatalog, setAllCatalog] = useState<IconCatalogEntry[] | null>(null);
  const [allLoading, setAllLoading] = useState(false);
  const [allError, setAllError] = useState(false);
  const [allLoadAttempt, setAllLoadAttempt] = useState(0);
  const [shownCount, setShownCount] = useState(INITIAL_VISIBLE_COUNT);
  const allScrollRef = useRef<HTMLDivElement>(null);
  const current = normalizePositionIcon(value);
  const selectedKey = iconKey(value);
  const committedColor = current?.color ?? POSITION_ICON_DEFAULT_COLOR;
  const [previewColor, setPreviewColor] = useState(() => getPositionIconColor(value));
  const [colorResetSignal, setColorResetSignal] = useState(0);
  const iconPreviewStyle = useMemo<IconPreviewStyle>(() => ({
    "--position-icon-preview-fill": previewColor,
    "--position-icon-preview-ink": contrastingInkForFill(previewColor),
  }), [previewColor]);

  useEffect(() => {
    setPreviewColor(committedColor);
  }, [committedColor]);

  useEffect(() => {
    if (!open || !legacyOnly || lucideCatalog) return;
    setLucideCatalog(getLucidePositionIconCatalog());
  }, [legacyOnly, lucideCatalog, open]);

  useEffect(() => {
    if (!open || legacyOnly || view !== "all") return;
    let active = true;
    setAllLoading(true);
    setAllError(false);
    loadPositionIconCatalog().then(
      (entries) => {
        if (active) {
          setAllCatalog(entries);
          setAllLoading(false);
        }
      },
      () => {
        if (active) {
          setAllLoading(false);
          setAllError(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [allLoadAttempt, legacyOnly, open, view]);

  const recommendedGroups = useMemo(() => RECOMMENDED_GROUPS.map((group) => {
    const entries = recommendedEntry(group);
    if (!query.trim()) return { ...group, icons: group.icons };
    const matches = new Set(searchPositionIconCatalog(entries, query, entries.length).map((entry) => iconKey(entry.ref)));
    return { ...group, icons: group.icons.filter((icon) => matches.has(iconKey(icon))) };
  }).filter((group) => group.icons.length > 0), [query]);

  const allResults = useMemo(() => {
    if (!allCatalog) return [];
    return query.trim()
      ? searchPositionIconCatalog(allCatalog, query, allCatalog.length)
      : allCatalog;
  }, [allCatalog, query]);

  useEffect(() => {
    setShownCount(INITIAL_VISIBLE_COUNT);
    if (allScrollRef.current) allScrollRef.current.scrollTop = 0;
  }, [query, view]);

  useLoadMoreOnScroll({
    scrollRef: allScrollRef,
    enabled: !legacyOnly && view === "all" && allResults.length > shownCount,
    totalAvailable: allResults.length,
    batchSize: LOAD_MORE_BATCH_SIZE,
    setShownCount,
    shownCount,
    rescheduleKey: `${view}:${query}:${allCatalog?.length || 0}`,
  });

  const selectIcon = useCallback((next: IconRef) => {
    if (legacyOnly) {
      onChange(next.source === "lucide" ? next.name : "");
      setOpen(false);
      setQuery("");
      return;
    }
    onChange({ ...next, ...(current?.color ? { color: current.color } : {}) });
    setQuery("");
  }, [current?.color, legacyOnly, onChange]);

  const selectView = (next: PickerView) => {
    if (next === "all" && !allCatalog) {
      setAllCatalog(getLucidePositionIconCatalog());
    }
    setView(next);
  };

  const setColor = (color?: string) => {
    if (!current) return;
    const { color: _previousColor, ...withoutColor } = current;
    onChange(color ? { ...withoutColor, color } : withoutColor);
  };

  const resetColor = () => {
    setPreviewColor(POSITION_ICON_DEFAULT_COLOR);
    setColorResetSignal((signal) => signal + 1);
    setColor();
  };

  const placeholder = legacyOnly
    ? "Search icons…"
    : view === "recommended"
      ? "Search recommended icons…"
      : "Search icons…";
  const currentLabel = current ? iconLabel(current) : "Choose an icon";
  const renderLegacyResults = (entries: IconCatalogEntry[]) => (
    entries.length ? (
      <div className="scrollbar-portal mt-2 grid max-h-56 grid-cols-7 gap-1 overflow-y-auto" aria-label="Icon results">
        {entries.slice(0, INITIAL_VISIBLE_COUNT).map((entry) => (
          <IconButton
            key={iconKey(entry.ref)}
            icon={entry.ref}
            label={entry.label}
            selected={selectedKey === iconKey(entry.ref)}
            onSelect={selectIcon}
          />
        ))}
      </div>
    ) : <p className="mt-2 text-sm text-gray-400">No matching icons.</p>
  );

  return (
    <div>
      <span className="block p-1 text-sm font-semibold text-white">{label}:</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label} picker`}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-left text-sm text-white",
              "hover:border-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40",
            )}
          >
            <PositionIconBadge icon={value} className="h-7 w-7" />
            <span className={cn(!value && "text-gray-400")}>{currentLabel}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 rounded-md border border-gray-700 bg-gray-900 p-3 shadow-xl">
          <div className="space-y-3">
            {!legacyOnly ? (
              <div className="flex gap-1" role="tablist" aria-label="Icon views">
                {(["recommended", "all"] as const).map((item) => (
                  <Button
                    key={item}
                    type="button"
                    variant={view === item ? "secondary" : "tertiary"}
                    padding="px-2 py-1"
                    className="h-7 min-h-0 text-xs"
                    role="tab"
                    aria-selected={view === item}
                    onClick={() => selectView(item)}
                  >
                    {item === "recommended" ? "Recommended" : "All icons"}
                  </Button>
                ))}
              </div>
            ) : null}
            <div style={iconPreviewStyle} data-testid="position-icon-preview-root">
              <Input
                label={placeholder}
                hideLabel
                placeholder={placeholder}
                value={query}
                onChange={(next) => setQuery(String(next))}
              />
              {legacyOnly ? query.trim() ? (
                renderLegacyResults(lucideCatalog ? searchPositionIconCatalog(lucideCatalog, query, lucideCatalog.length) : [])
              ) : (
                <div className="scrollbar-portal mt-2 grid max-h-56 grid-cols-7 gap-1 overflow-y-auto" aria-label="Icon results">
                  {LEGACY_TEAM_ICONS.map((icon) => (
                    <IconButton key={iconKey(icon)} icon={icon} label={iconLabel(icon)} selected={selectedKey === iconKey(icon)} onSelect={selectIcon} />
                  ))}
                </div>
              ) : view === "recommended" ? (
                recommendedGroups.length ? (
                  <div className="scrollbar-portal mt-2 max-h-56 space-y-2 overflow-y-auto" aria-label="Recommended icon results">
                    {recommendedGroups.map((group) => (
                      <section key={group.label}>
                        <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{group.label}</h3>
                        <div className="grid grid-cols-7 gap-1">
                          {group.icons.map((icon) => (
                            <IconButton key={iconKey(icon)} icon={icon} label={iconLabel(icon)} selected={selectedKey === iconKey(icon)} onSelect={selectIcon} />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : <p className="mt-2 text-sm text-gray-400">No matching icons.</p>
              ) : allCatalog ? (
                <>
                  <div ref={allScrollRef} className="scrollbar-portal mt-2 grid max-h-56 grid-cols-7 gap-1 overflow-y-auto" aria-label="All icon results">
                    {allResults.slice(0, shownCount).map((entry) => (
                      <IconButton
                        key={iconKey(entry.ref)}
                        icon={entry.ref}
                        label={entry.label}
                        selected={selectedKey === iconKey(entry.ref)}
                        onSelect={selectIcon}
                      />
                    ))}
                  </div>
                  {allLoading ? <p className="mt-2 text-xs text-gray-500" role="status">Loading more icons…</p> : null}
                  {allError ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-sm text-amber-300" role="alert">Some icons are unavailable.</p>
                      <Button type="button" variant="textLink" padding="p-0" className="text-xs text-gray-300" onClick={() => setAllLoadAttempt((attempt) => attempt + 1)}>Try again</Button>
                    </div>
                  ) : null}
                  {!allResults.length && !allLoading && !allError ? <p className="mt-2 text-sm text-gray-400">No matching icons.</p> : null}
                </>
              ) : <p className="mt-2 text-sm text-gray-400" role="status">Loading icons…</p>}
            </div>
            {current && !legacyOnly ? (
              <div className="space-y-2 border-t border-gray-800 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-300">Icon color</span>
                  <Button type="button" variant="textLink" padding="p-0" className="text-xs text-gray-400" onClick={resetColor}>Default</Button>
                </div>
                <div className="flex items-center gap-2">
                  <CompactColorPicker
                    label="Choose custom icon color"
                    value={current.color ?? POSITION_ICON_DEFAULT_COLOR}
                    debounceParentCommitMs={180}
                    onPreviewChange={setPreviewColor}
                    resetSignal={colorResetSignal}
                    onChange={(color) => setColor(color)}
                  />
                </div>
              </div>
            ) : null}
            {value ? (
              <Button type="button" variant="textLink" padding="p-0" className="text-xs text-gray-400 hover:text-gray-200" onClick={() => onChange("")}>Clear icon</Button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default PositionIconPicker;
