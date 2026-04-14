import type { ItemSlideType, ItemType, SlideType } from "../types";

/** Removes trailing overflow split markers from song slide headings (e.g. `\u200Bb\u200B`). */
export function normalizeSongSlideSectionName(name: string): string {
  return name.replace(/(\u200B[a-z]+\u200B)+$/gi, "").trimEnd();
}

/** Contiguous slide ids around `selectedIndex` sharing the same `slide.type`. */
export function getContiguousSameTypeSlideIds(
  slides: ItemSlideType[],
  selectedIndex: number,
): string[] {
  if (selectedIndex < 0 || selectedIndex >= slides.length) return [];
  const t = slides[selectedIndex].type;
  let start = selectedIndex;
  while (start > 0 && slides[start - 1].type === t) start--;
  let end = selectedIndex;
  while (end < slides.length - 1 && slides[end + 1].type === t) end++;
  const ids: string[] = [];
  for (let i = start; i <= end; i++) ids.push(slides[i].id);
  return ids;
}

/**
 * "This section" targets: for songs, contiguous slides with the same section **name**
 * (Verse 1 vs Verse 2), not the same `SlideType` (all Verse). Other item kinds keep
 * contiguous same `slide.type`.
 */
export function getThisSectionSlideIds(
  slides: ItemSlideType[],
  selectedIndex: number,
  itemType: ItemType,
): string[] {
  if (selectedIndex < 0 || selectedIndex >= slides.length) return [];
  if (itemType === "song") {
    const key = normalizeSongSlideSectionName(slides[selectedIndex].name);
    let start = selectedIndex;
    while (
      start > 0 &&
      normalizeSongSlideSectionName(slides[start - 1].name) === key
    ) {
      start--;
    }
    let end = selectedIndex;
    while (
      end < slides.length - 1 &&
      normalizeSongSlideSectionName(slides[end + 1].name) === key
    ) {
      end++;
    }
    const ids: string[] = [];
    for (let i = start; i <= end; i++) ids.push(slides[i].id);
    return ids;
  }
  return getContiguousSameTypeSlideIds(slides, selectedIndex);
}

/**
 * All slides whose normalized section **name** matches the selected slide (song only).
 * E.g. every "Chorus 1" block in the arrangement, not "Chorus 2" and not every `Chorus` type.
 */
export function getAllMatchingSectionNameSlideIds(
  slides: ItemSlideType[],
  selectedIndex: number,
  itemType: ItemType,
): string[] {
  if (itemType !== "song") return [];
  if (selectedIndex < 0 || selectedIndex >= slides.length) return [];
  const key = normalizeSongSlideSectionName(slides[selectedIndex].name);
  if (!key) return [];
  return slides
    .filter((s) => normalizeSongSlideSectionName(s.name) === key)
    .map((s) => s.id);
}

/** All slides in the arrangement matching the selected slide's type (song items only). */
export function getAllMatchingTypeSlideIds(
  slides: ItemSlideType[],
  selectedIndex: number,
  itemType: ItemType,
): string[] {
  if (itemType !== "song") return [];
  if (selectedIndex < 0 || selectedIndex >= slides.length) return [];
  const t = slides[selectedIndex].type;
  return slides.filter((s) => s.type === t).map((s) => s.id);
}

export function filterExistingSlideIds(
  slides: ItemSlideType[],
  ids: string[],
): string[] {
  const set = new Set(slides.map((s) => s.id));
  return ids.filter((id) => set.has(id));
}

export function slideTypeLabelForMenu(type: SlideType): string {
  return type;
}

/**
 * Inclusive index range from anchor slide to focus index.
 * If anchor id is missing or not found, uses `fallbackSelectedIndex` as anchor.
 */
export function inclusiveRangeIndicesFromAnchor(
  slides: ItemSlideType[],
  anchorId: string | null,
  focusIndex: number,
  fallbackSelectedIndex: number,
): number[] {
  if (focusIndex < 0 || focusIndex >= slides.length) return [];
  let anchorIndex =
    anchorId !== null ? slides.findIndex((s) => s.id === anchorId) : -1;
  if (anchorIndex < 0) {
    anchorIndex = fallbackSelectedIndex;
  }
  if (anchorIndex < 0 || anchorIndex >= slides.length) return [focusIndex];
  const lo = Math.min(anchorIndex, focusIndex);
  const hi = Math.max(anchorIndex, focusIndex);
  const out: number[] = [];
  for (let i = lo; i <= hi && i < slides.length; i++) out.push(i);
  return out;
}
