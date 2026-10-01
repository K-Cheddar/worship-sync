import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import * as LucideIcons from "lucide-react";
import type { EntityIcon, IconCatalogEntry, IconRef } from "./iconTypes";
import { worshipSyncProductionIcons } from "./production";

export type EntityGlyphProps = SVGProps<SVGSVGElement> & { size?: number | string };
export type EntityGlyph = ComponentType<EntityGlyphProps>;
/** @deprecated Use EntityGlyphProps. */
export type PositionGlyphProps = EntityGlyphProps;
/** @deprecated Use EntityGlyph. */
export type PositionGlyph = EntityGlyph;

export const formatEntityIconLabel = (name: string): string => {
  const words = name
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : name;
};
/** @deprecated Use formatEntityIconLabel. */
export const formatPositionIconLabel = formatEntityIconLabel;

const lucideExports = LucideIcons as Record<string, unknown>;
const excludedLucideExports = new Set([
  "createLucideIcon", "Icon", "icons", "LucideProps", "default",
]);

const isIconComponent = (value: unknown): value is PositionGlyph =>
  typeof value === "function" || (typeof value === "object" && value !== null);

export const normalizeEntityIcon = (
  value?: EntityIcon | null,
): IconRef | null => {
  if (typeof value === "string") {
    return value ? { source: "lucide", name: value } : null;
  }
  if (!value || typeof value !== "object") return null;
  const color = value.color;
  if (color !== undefined && (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))) return null;
  const colorField = color ? { color } : {};
  if (value.source === "custom") {
    return typeof value.id === "string" && value.id.trim()
      ? { source: "custom", id: value.id.trim(), ...colorField }
      : null;
  }
  if (
    (value.source === "lucide" || value.source === "tabler" || value.source === "worshipsync") &&
    typeof value.name === "string" && value.name.trim()
  ) {
    return { source: value.source, name: value.name.trim(), ...colorField };
  }
  return null;
};
/** @deprecated Use normalizeEntityIcon. */
export const normalizePositionIcon = normalizeEntityIcon;

const tablerExportName = (name: string) =>
  `Icon${name.split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : "").join("")}`;

let tablerPromise: Promise<Record<string, unknown>> | null = null;
const resolvedTablerIcons = new Map<string, PositionGlyph | null>();
const loadTablerIcons = () => {
  if (!tablerPromise) {
    const request = import("@tabler/icons-react").then(
      (module) => module as Record<string, unknown>,
    );
    const retryableRequest = request.catch((error: unknown) => {
      if (tablerPromise === retryableRequest) tablerPromise = null;
      throw error;
    });
    tablerPromise = retryableRequest;
  }
  return tablerPromise;
};

export const TablerGlyph = ({ name, ...props }: PositionGlyphProps & { name: string }) => {
  const [resolved, setResolved] = useState<{ name: string; icon: PositionGlyph | null } | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => {
      if (resolvedTablerIcons.has(name)) {
        if (active) setResolved({ name, icon: resolvedTablerIcons.get(name) ?? null });
        return;
      }
      loadTablerIcons().then((icons) => {
        const candidate = icons[tablerExportName(name)];
        const icon = isIconComponent(candidate) ? candidate : null;
        resolvedTablerIcons.set(name, icon);
        if (active) setResolved({ name, icon });
      }).catch(() => {
        // Leave module-load failures uncached so online or a later mount can retry.
      });
    };
    load();
    window.addEventListener("online", load);
    return () => {
      active = false;
      window.removeEventListener("online", load);
    };
  }, [name]);
  let Icon: PositionGlyph | null = null;
  if (resolvedTablerIcons.has(name)) {
    Icon = resolvedTablerIcons.get(name) ?? null;
  } else if (resolved?.name === name) {
    Icon = resolved.icon;
  }
  return Icon ? <Icon {...props} /> : null;
};

/** Resolve only icon sources available synchronously; Tabler uses TablerGlyph. */
export const resolveWorshipSyncIcon = (
  value?: EntityIcon | null,
): EntityGlyph | null => {
  const ref = normalizeEntityIcon(value);
  if (!ref || ref.source === "custom") return null;
  if (ref.source === "tabler") return null;
  if (ref.source === "worshipsync") return worshipSyncProductionIcons[ref.name] || null;
  const exportName = ref.name;
  const icon = lucideExports[exportName];
  return isIconComponent(icon) ? icon : null;
};

const lucideAliases: Record<string, string[]> = {
  Mic: ["microphone", "audio"],
  Mic2: ["microphone", "audio"],
  MicVocal: ["microphone", "vocal", "audio"],
  SlidersHorizontal: ["mixer", "faders", "audio"],
  AudioLines: ["audio", "waveform"],
  AudioWaveform: ["audio", "waveform"],
  Video: ["camera", "broadcast"],
  Lightbulb: ["light", "lighting"],
  Presentation: ["projector", "presentation"],
};
let lucideCatalog: IconCatalogEntry[] | null = null;
export const getLucideEntityIconCatalog = (): IconCatalogEntry[] => {
  lucideCatalog ??= Object.entries(lucideExports)
    .filter(([name, icon]) => /^[A-Z]/.test(name) && !name.startsWith("Lucide") && !excludedLucideExports.has(name) && isIconComponent(icon))
    .map(([name]) => ({
      ref: { source: "lucide", name },
      label: formatEntityIconLabel(name),
      searchTerms: [name, ...(lucideAliases[name] || [])],
    }));
  return lucideCatalog;
};
/** @deprecated Use getLucideEntityIconCatalog. */
export const getLucidePositionIconCatalog = getLucideEntityIconCatalog;

const createTablerEntityIconCatalog = (
  tablerIcons: Record<string, unknown>,
): IconCatalogEntry[] => Object.keys(tablerIcons)
  .filter((name) => /^Icon[A-Z]/.test(name) && isIconComponent(tablerIcons[name]))
  .map((exportName) => {
    const name = exportName.slice(4).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    return {
      ref: { source: "tabler", name } as const,
      label: formatEntityIconLabel(name),
      searchTerms: [name],
    };
  });

let tablerCatalogPromise: Promise<IconCatalogEntry[]> | null = null;
export const loadTablerEntityIconCatalog = (): Promise<IconCatalogEntry[]> => {
  if (!tablerCatalogPromise) {
    const request = loadTablerIcons().then(createTablerEntityIconCatalog);
    const retryableRequest = request.catch((error: unknown) => {
      if (tablerCatalogPromise === retryableRequest) tablerCatalogPromise = null;
      throw error;
    });
    tablerCatalogPromise = retryableRequest;
  }
  return tablerCatalogPromise;
};
/** @deprecated Use loadTablerEntityIconCatalog. */
export const loadTablerPositionIconCatalog = loadTablerEntityIconCatalog;

let catalogPromise: Promise<IconCatalogEntry[]> | null = null;
export const loadEntityIconCatalog = (): Promise<IconCatalogEntry[]> => {
  if (!catalogPromise) {
    const request = loadTablerEntityIconCatalog().then((tablerEntries) => {
      return [...getLucideEntityIconCatalog(), ...tablerEntries];
    });
    const retryableRequest = request.catch((error: unknown) => {
      if (catalogPromise === retryableRequest) catalogPromise = null;
      throw error;
    });
    catalogPromise = retryableRequest;
  }
  return catalogPromise;
};
/** @deprecated Use loadEntityIconCatalog. */
export const loadPositionIconCatalog = loadEntityIconCatalog;

export const searchEntityIconCatalog = (
  catalog: IconCatalogEntry[],
  query: string,
  limit = 60,
): IconCatalogEntry[] => {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return catalog
    .map((entry) => {
      const searchable = `${entry.label} ${entry.searchTerms.join(" ")}`.toLowerCase().replace(/([a-z])([A-Z])/g, "$1 $2");
      const score = tokens.every((token) => searchable.includes(token))
        ? (searchable.startsWith(tokens[0]) ? 0 : 1)
        : -1;
      return { entry, score };
    })
    .filter(({ score }) => score >= 0)
    .sort((a, b) => a.score - b.score || a.entry.label.localeCompare(b.entry.label))
    .slice(0, limit)
    .map(({ entry }) => entry);
};
/** @deprecated Use searchEntityIconCatalog. */
export const searchPositionIconCatalog = searchEntityIconCatalog;
