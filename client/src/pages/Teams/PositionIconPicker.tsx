import { useEffect, useMemo, useState } from "react";

import { cn } from "@/utils/cnHelper";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import Input from "../../components/Input/Input";
import Button from "../../components/Button/Button";
import WorshipSyncIcon from "../../components/icons/WorshipSyncIcon";
import type { IconCatalogEntry, IconRef, PositionIcon } from "../../components/icons/iconTypes";
import {
  getLucidePositionIconCatalog,
  loadTablerPositionIconCatalog,
  normalizePositionIcon,
  searchPositionIconCatalog,
} from "../../components/icons/iconRegistry";
import { CompactColorPicker } from "../../components/ColorField/ColorField";

const SEARCH_RESULT_LIMIT = 60;
const DEFAULT_ICON_COLOR = "#22d3ee";
const LEGACY_TEAM_ICONS = [
  "Mic", "Mic2", "MicVocal", "Music", "Music2", "Music4", "Guitar", "Piano", "Drum",
  "Speaker", "Headphones", "Volume2", "AudioLines", "AudioWaveform", "Radio", "SlidersHorizontal",
  "Video", "Camera", "Clapperboard", "Projector", "MonitorPlay", "Tv", "Lightbulb", "Sparkles",
  "Presentation", "Captions", "Users", "User", "UserCog", "Hand", "Church", "BookOpen", "Cross", "Heart", "Star", "Wrench",
].map((name) => ({ source: "lucide", name }) as IconRef);

export const RECOMMENDED_GROUPS: Array<{ label: string; icons: IconRef[] }> = [
  { label: "Audio", icons: [
    { source: "lucide", name: "MicVocal" }, { source: "tabler", name: "microphone" },
    { source: "lucide", name: "Headphones" }, { source: "tabler", name: "speakerphone" },
    { source: "lucide", name: "AudioWaveform" }, { source: "tabler", name: "wave-sine" },
    { source: "lucide", name: "SlidersHorizontal" }, { source: "tabler", name: "adjustments-horizontal" },
  ] },
  { label: "Video", icons: [
    { source: "lucide", name: "Video" }, { source: "tabler", name: "camera" },
    { source: "tabler", name: "video" }, { source: "lucide", name: "Tv" },
    { source: "tabler", name: "device-tv" }, { source: "lucide", name: "Presentation" },
    { source: "tabler", name: "broadcast" },
  ] },
  { label: "Lighting", icons: [
    { source: "lucide", name: "Lightbulb" }, { source: "tabler", name: "bulb" },
    { source: "lucide", name: "Sparkles" },
  ] },
  { label: "Music", icons: [
    { source: "lucide", name: "Guitar" }, { source: "tabler", name: "guitar-pick" },
    { source: "lucide", name: "Piano" }, { source: "tabler", name: "piano" },
    { source: "lucide", name: "Music" }, { source: "tabler", name: "music" },
    { source: "lucide", name: "Drum" },
  ] },
  { label: "Ministry", icons: [
    { source: "lucide", name: "User" }, { source: "tabler", name: "users" },
    { source: "lucide", name: "BookOpen" }, { source: "tabler", name: "book2" },
    { source: "lucide", name: "Church" }, { source: "tabler", name: "building-church" },
    { source: "lucide", name: "Hand" }, { source: "tabler", name: "heart" },
    { source: "lucide", name: "Cross" },
  ] },
];

type PositionIconPickerProps = {
  label?: string;
  legacyOnly?: boolean;
  value: PositionIcon | "";
  onChange: (icon: PositionIcon | "") => void;
};

type IconButtonProps = {
  icon: PositionIcon;
  label: string;
  selected: boolean;
  onSelect: () => void;
};

const IconButton = ({ icon, label, selected, onSelect }: IconButtonProps) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-pressed={selected}
    onClick={onSelect}
    className={cn(
      "flex h-9 w-9 items-center justify-center rounded-md border text-gray-100",
      "hover:bg-gray-800",
      selected ? "border-cyan-400 bg-cyan-400/15 text-cyan-100" : "border-gray-700",
    )}
  >
    <WorshipSyncIcon icon={icon} className="h-5 w-5" />
  </button>
);

const iconKey = (icon: PositionIcon | "") => {
  const ref = normalizePositionIcon(icon);
  return ref ? ("name" in ref ? `${ref.source}:${ref.name}` : `${ref.source}:${ref.id}`) : "";
};

const recommendedEntry = (group: { label: string; icons: IconRef[] }): IconCatalogEntry[] =>
  group.icons.map((ref) => ({
    ref,
    label: "name" in ref ? ref.name : ref.id,
    searchTerms: [group.label],
  }));

const PositionIconPicker = ({ label = "Icon", legacyOnly = false, value, onChange }: PositionIconPickerProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"recommended" | "lucide" | "tabler">("recommended");
  const [lucideCatalog, setLucideCatalog] = useState<IconCatalogEntry[] | null>(null);
  const [tablerCatalog, setTablerCatalog] = useState<IconCatalogEntry[] | null>(null);
  const [tablerLoading, setTablerLoading] = useState(false);
  const [tablerError, setTablerError] = useState(false);
  const [tablerLoadAttempt, setTablerLoadAttempt] = useState(0);
  const current = normalizePositionIcon(value);
  const selectedKey = iconKey(value);

  useEffect(() => {
    if (!open || !legacyOnly || lucideCatalog) return;
    setLucideCatalog(getLucidePositionIconCatalog());
  }, [legacyOnly, lucideCatalog, open]);

  useEffect(() => {
    if (!open || legacyOnly || source !== "tabler" || tablerCatalog) return;
    let active = true;
    const loadCatalog = () => {
      setTablerLoading(true);
      setTablerError(false);
      loadTablerPositionIconCatalog().then(
        (entries) => {
          if (active) {
            setTablerCatalog(entries);
            setTablerLoading(false);
          }
        },
        () => {
          if (active) {
            setTablerLoading(false);
            setTablerError(true);
          }
        },
      );
    };
    loadCatalog();
    window.addEventListener("online", loadCatalog);
    return () => {
      active = false;
      window.removeEventListener("online", loadCatalog);
    };
  }, [legacyOnly, open, source, tablerCatalog, tablerLoadAttempt]);

  const recommendedGroups = useMemo(() => RECOMMENDED_GROUPS.map((group) => {
    const entries = recommendedEntry(group);
    if (!query.trim()) return { ...group, icons: group.icons };
    const matches = new Set(searchPositionIconCatalog(entries, query, SEARCH_RESULT_LIMIT).map((entry) => iconKey(entry.ref)));
    return { ...group, icons: group.icons.filter((icon) => matches.has(iconKey(icon))) };
  }).filter((group) => group.icons.length > 0), [query]);

  const catalogResults = useMemo(() => {
    const catalog = source === "lucide" ? lucideCatalog : tablerCatalog;
    if (!catalog) return [];
    return query.trim()
      ? searchPositionIconCatalog(catalog, query, SEARCH_RESULT_LIMIT + 1)
      : catalog.slice(0, SEARCH_RESULT_LIMIT + 1);
  }, [lucideCatalog, query, source, tablerCatalog]);

  const selectIcon = (next: IconRef) => {
    if (legacyOnly) {
      onChange(next.source === "lucide" ? next.name : "");
      setOpen(false);
      setQuery("");
      return;
    }
    onChange({ ...next, ...(current?.color ? { color: current.color } : {}) });
    setQuery("");
  };

  const selectSource = (next: "recommended" | "lucide" | "tabler") => {
    if (next === "lucide" && !lucideCatalog) {
      setLucideCatalog(getLucidePositionIconCatalog());
    }
    setSource(next);
  };

  const setColor = (color?: string) => {
    if (!current) return;
    const { color: _previousColor, ...withoutColor } = current;
    onChange(color ? { ...withoutColor, color } : withoutColor);
  };

  const resultLabel = (entry: IconCatalogEntry) => `${entry.ref.source}: ${entry.label}`;
  const placeholder = legacyOnly
    ? "Search Lucide icons…"
    : source === "recommended"
      ? "Search recommended icons…"
      : `Search ${source === "lucide" ? "Lucide" : "Tabler"} icons…`;
  const renderCatalogResults = (entries: IconCatalogEntry[]) => (
    entries.length ? (
      <>
        <div className="mt-2 grid max-h-56 grid-cols-7 gap-1 overflow-y-auto" aria-label={`${source} icon results`}>
          {entries.slice(0, SEARCH_RESULT_LIMIT).map((entry) => (
            <IconButton
              key={iconKey(entry.ref)}
              icon={entry.ref}
              label={resultLabel(entry)}
              selected={selectedKey === iconKey(entry.ref)}
              onSelect={() => selectIcon(entry.ref)}
            />
          ))}
        </div>
        {entries.length > SEARCH_RESULT_LIMIT ? (
          <p className="mt-2 text-xs text-gray-500">Showing first {SEARCH_RESULT_LIMIT}. Refine your search.</p>
        ) : null}
      </>
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
            <span className="flex h-7 w-7 items-center justify-center rounded border border-cyan-300/30 bg-cyan-400/10 text-cyan-100">
              <WorshipSyncIcon icon={value} className="h-4 w-4" />
            </span>
            <span className={cn(!value && "text-gray-400")}>
              {current ? ("name" in current ? current.name : current.id) : "Choose an icon"}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 rounded-md border border-gray-700 bg-gray-900 p-3 shadow-xl">
          <div className="space-y-3">
            {!legacyOnly ? <div className="flex gap-1" role="tablist" aria-label="Icon source">
              {(["recommended", "lucide", "tabler"] as const).map((item) => (
                <Button
                  key={item}
                  type="button"
                  variant={source === item ? "secondary" : "tertiary"}
                  padding="px-2 py-1"
                  className="h-7 min-h-0 text-xs capitalize"
                  role="tab"
                  aria-selected={source === item}
                  onClick={() => selectSource(item)}
                >
                  {item === "recommended" ? "Recommended" : item}
                </Button>
              ))}
            </div> : null}
            <div>
              <Input
                label={placeholder}
                hideLabel
                placeholder={placeholder}
                value={query}
                onChange={(next) => setQuery(String(next))}
              />
              {legacyOnly ? query.trim() ? renderCatalogResults(lucideCatalog ? searchPositionIconCatalog(lucideCatalog, query, SEARCH_RESULT_LIMIT + 1) : []) : (
                <div className="mt-2 grid max-h-56 grid-cols-7 gap-1 overflow-y-auto">
                  {LEGACY_TEAM_ICONS.map((icon) => (
                    <IconButton key={iconKey(icon)} icon={icon} label={"name" in icon ? icon.name : icon.id} selected={selectedKey === iconKey(icon)} onSelect={() => selectIcon(icon)} />
                  ))}
                </div>
              ) : source === "recommended" ? (
                recommendedGroups.length ? (
                  <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                    {recommendedGroups.map((group) => (
                      <section key={group.label}>
                        <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{group.label}</h3>
                        <div className="grid grid-cols-7 gap-1">
                          {group.icons.map((icon) => (
                            <IconButton key={iconKey(icon)} icon={icon} label={iconKey(icon).replace(":", ": ")} selected={selectedKey === iconKey(icon)} onSelect={() => selectIcon(icon)} />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : <p className="mt-2 text-sm text-gray-400">No matching icons.</p>
              ) : tablerLoading ? (
                <p className="mt-2 text-sm text-gray-400" role="status">Loading Tabler icons…</p>
              ) : tablerError ? (
                <div className="mt-2 space-y-2">
                  <p className="text-sm text-amber-300" role="alert">Tabler icons are unavailable.</p>
                  <Button type="button" variant="textLink" padding="p-0" className="text-xs text-gray-300" onClick={() => setTablerLoadAttempt((attempt) => attempt + 1)}>Try again</Button>
                </div>
              ) : renderCatalogResults(catalogResults)}
            </div>
            {current && !legacyOnly ? (
              <div className="space-y-2 border-t border-gray-800 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-300">Icon color</span>
                  <Button type="button" variant="textLink" padding="p-0" className="text-xs text-gray-400" onClick={() => setColor()}>Default</Button>
                </div>
                <div className="flex items-center gap-2">
                  <CompactColorPicker
                    label="Choose custom icon color"
                    value={current.color || DEFAULT_ICON_COLOR}
                    showUnset={!current.color}
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
