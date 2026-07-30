import type { CSSProperties } from "react";

/** Typical dark note surfaces (editor `neutral-900`, public `slate-950`). */
export const RICH_TEXT_DARK_SURFACE = "#171717";

/**
 * Author-chosen color on a colored span/font. Display may rewrite `style.color`
 * to chip ink (white/black); readers must prefer this attribute so commits do
 * not persist the display ink.
 */
export const RICH_TEXT_COLOR_ATTR = "data-rich-text-color";

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f]{3})$/i;

/** Normalize `#rgb` / `#rrggbb` to lowercase `#rrggbb`, or null if invalid. */
export const normalizeHexColor = (
  color: string | undefined | null,
): string | null => {
  if (!color) return null;
  const trimmed = color.trim();
  const short = HEX3.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const full = HEX6.exec(trimmed);
  return full ? `#${full[1].toLowerCase()}` : null;
};

const channelToLinear = (channel: number): number => {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance for a hex color, or null if invalid. */
export const relativeLuminance = (hex: string): number | null => {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
};

/** WCAG contrast ratio between two hex colors (1–21), or null if invalid. */
export const contrastRatio = (
  foreground: string,
  background: string,
): number | null => {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  if (fg === null || bg === null) return null;
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
};

/** Black or white label text that contrasts with a solid chip fill. */
export const contrastingInkForFill = (
  fillHex: string,
): "#000000" | "#ffffff" => {
  const luminance = relativeLuminance(fillHex);
  // Midpoint of WCAG relative luminance — matches common chip label practice.
  return luminance !== null && luminance > 0.45 ? "#000000" : "#ffffff";
};

/**
 * Chip only when the color is hard to see on dark notes. Using full AA (4.5)
 * was too aggressive — mid grays and many brand blues/reds were getting chips
 * when plain colored text was already readable.
 */
const CHIP_WHEN_CONTRAST_BELOW = 2.5;

/**
 * On dark note surfaces, very low-contrast colors become a solid color chip
 * with readable ink so the hue stays obvious. Colors that are already visible
 * enough keep plain colored text.
 * Display-only — callers must not persist these extra styles into the model.
 */
export const readableRichTextColorStyle = (
  color: string | undefined | null,
  backgroundHex: string = RICH_TEXT_DARK_SURFACE,
): CSSProperties => {
  const safe = normalizeHexColor(color);
  if (!safe) return {};

  const ratio = contrastRatio(safe, backgroundHex);
  if (ratio === null || ratio >= CHIP_WHEN_CONTRAST_BELOW) {
    return { color: safe };
  }

  const ink = contrastingInkForFill(safe);
  const style: CSSProperties = {
    color: ink,
    backgroundColor: safe,
    borderRadius: "0.25rem",
    padding: "0 0.28em",
  };

  // Near-black chips need an edge so they don't dissolve into the dark surface.
  if ((relativeLuminance(safe) ?? 0) < 0.08) {
    style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,0.35)";
  }

  return style;
};

/** Apply / clear display-only contrast helpers on a colored DOM node. */
export const applyReadableRichTextColorToElement = (
  el: HTMLElement,
  color: string | undefined | null,
  backgroundHex: string = RICH_TEXT_DARK_SURFACE,
): void => {
  const safe = normalizeHexColor(color);
  if (safe) el.setAttribute(RICH_TEXT_COLOR_ATTR, safe);
  else el.removeAttribute(RICH_TEXT_COLOR_ATTR);

  const style = readableRichTextColorStyle(color, backgroundHex);
  el.style.color = style.color ? String(style.color) : "";
  el.style.backgroundColor = style.backgroundColor
    ? String(style.backgroundColor)
    : "";
  el.style.borderRadius = style.borderRadius ? String(style.borderRadius) : "";
  el.style.padding = style.padding ? String(style.padding) : "";
  el.style.boxShadow = style.boxShadow ? String(style.boxShadow) : "";
  el.style.textShadow = "";
};
