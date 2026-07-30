import type {
  RichTextAlign,
  RichTextBlock,
  RichTextDocument,
  RichTextSize,
  RichTextSpan,
} from "../../types/richText";
import {
  applyReadableRichTextColorToElement,
  RICH_TEXT_COLOR_ATTR,
} from "../../utils/richTextColorContrast";

export const BLOCK_TYPE_ATTR = "data-block-type";
/** Size rides on an attribute rather than an inline font-size so it round-trips
 * exactly — browsers normalize a written CSS size to px on read-back. */
export const BLOCK_SIZE_ATTR = "data-block-size";

const toHexPair = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");

/**
 * Browsers normalize `element.style.color` to `rgb(r, g, b)` regardless of the
 * format it was set in, but `#rrggbb` is the only form the stored model (and
 * the server's rich-text validator) accepts — an un-normalized `rgb(...)` is
 * silently dropped on save. Anything unrecognized returns undefined so the
 * span simply carries no color rather than an invalid one.
 */
export const normalizeCssColorToHex = (raw: string): string | undefined => {
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;

  const shortHex = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (shortHex) {
    const [, r, g, b] = shortHex;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{6}$/.test(value)) return value;

  const rgb = value.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*[\d.%]+\s*)?\)$/,
  );
  if (rgb) {
    const [, r, g, b] = rgb;
    return `#${toHexPair(Number(r))}${toHexPair(Number(g))}${toHexPair(Number(b))}`;
  }

  return undefined;
};

/**
 * Resolve the operator-authored color for a colored span/font. Contrast chips
 * may rewrite `style.color` to white/black ink; prefer the data attr, then
 * chip fill / font color, and only then style.color.
 */
export const resolveAuthoredRichTextColorFromElement = (
  el: HTMLElement,
): string | undefined => {
  const fromAttr = normalizeCssColorToHex(
    el.getAttribute(RICH_TEXT_COLOR_ATTR) || "",
  );
  if (fromAttr) return fromAttr;

  if (el.tagName.toLowerCase() === "font") {
    const fromFont = normalizeCssColorToHex(el.getAttribute("color") || "");
    if (fromFont) return fromFont;
  }

  // Chip fill is the authored hue when display ink replaced style.color.
  if (el.style.backgroundColor) {
    const fromBg = normalizeCssColorToHex(el.style.backgroundColor);
    if (fromBg) return fromBg;
  }

  if (el.style.color) return normalizeCssColorToHex(el.style.color);
  return undefined;
};

/**
 * Restore authored colors before execCommand applies a new one. Contrast chips
 * replace style.color with readable ink and retain the hue in a data attribute;
 * leaving that stale attribute in place can make a later decoration pass undo
 * a recolor. This keeps the DOM flat/stable while making style.color authoritative
 * for the next browser command.
 */
export const prepareRichTextColorsForBrowserCommand = (
  container: HTMLElement,
): void => {
  container.querySelectorAll<HTMLElement>("span, font").forEach((el) => {
    const authoredColor = resolveAuthoredRichTextColorFromElement(el);
    if (!authoredColor) return;

    el.removeAttribute(RICH_TEXT_COLOR_ATTR);
    el.style.color = authoredColor;
    el.style.backgroundColor = "";
    el.style.borderRadius = "";
    el.style.padding = "";
    el.style.boxShadow = "";
    el.style.textShadow = "";
  });
};

/**
 * Renders a RichTextDocument into `container` as real DOM nodes (never via
 * innerHTML/string concatenation — nothing here parses untrusted markup).
 * One top-level element per block; list-item blocks get a bullet drawn by
 * a data attribute + CSS (see RichTextEditor.tsx), not real <ul>/<li>
 * nesting, since the model is a flat block list rather than a nested list.
 */
export const renderRichTextIntoElement = (
  container: HTMLElement,
  doc: RichTextDocument,
): void => {
  container.textContent = "";
  const blocks = doc.blocks.length
    ? doc.blocks
    : [{ type: "paragraph" as const, spans: [] }];
  blocks.forEach((block) => {
    const blockEl = document.createElement("div");
    blockEl.setAttribute(BLOCK_TYPE_ATTR, block.type);
    if (block.align) blockEl.style.textAlign = block.align;
    if (block.size) blockEl.setAttribute(BLOCK_SIZE_ATTR, block.size);
    if (block.spans.length === 0) {
      blockEl.appendChild(document.createElement("br"));
    }
    block.spans.forEach((span) => {
      let node: Node = document.createTextNode(span.text);
      if (span.bold) {
        const el = document.createElement("strong");
        el.appendChild(node);
        node = el;
      }
      if (span.italic) {
        const el = document.createElement("em");
        el.appendChild(node);
        node = el;
      }
      if (span.underline) {
        const el = document.createElement("u");
        el.appendChild(node);
        node = el;
      }
      if (span.color) {
        const el = document.createElement("span");
        applyReadableRichTextColorToElement(el, span.color);
        el.appendChild(node);
        node = el;
      }
      blockEl.appendChild(node);
    });
    container.appendChild(blockEl);
  });
};

const collectSpansFromInlineNode = (
  node: ChildNode,
  formatting: Pick<RichTextSpan, "bold" | "italic" | "underline" | "color">,
): RichTextSpan[] => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || "";
    return text ? [{ text, ...formatting }] : [];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const nextFormatting = { ...formatting };
  if (tag === "strong" || tag === "b") nextFormatting.bold = true;
  if (tag === "em" || tag === "i") nextFormatting.italic = true;
  if (tag === "u") nextFormatting.underline = true;
  // Prefer the authored color attr — contrast chips may rewrite style.color to
  // white/black ink for readability without changing what we persist.
  const authoredColor = resolveAuthoredRichTextColorFromElement(el);
  if (authoredColor) nextFormatting.color = authoredColor;
  if (tag === "br") return [];
  return Array.from(el.childNodes).flatMap((child) =>
    collectSpansFromInlineNode(child, nextFormatting),
  );
};

/** Merges consecutive spans with identical formatting (formatting toggles via
 * execCommand can otherwise split what's conceptually one run into several
 * adjacent DOM nodes). */
const mergeAdjacentSpans = (spans: RichTextSpan[]): RichTextSpan[] =>
  spans.reduce<RichTextSpan[]>((merged, span) => {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.bold === span.bold &&
      previous.italic === span.italic &&
      previous.underline === span.underline &&
      previous.color === span.color
    ) {
      previous.text += span.text;
      return merged;
    }
    return [...merged, { ...span }];
  }, []);

export const blockTypeOf = (el: HTMLElement): RichTextBlock["type"] =>
  el.getAttribute(BLOCK_TYPE_ATTR) === "list-item" ? "list-item" : "paragraph";

/** Left is the default, so it reads back as absent rather than "left". */
export const blockAlignOf = (el: HTMLElement): RichTextAlign | undefined => {
  const align = el.style.textAlign;
  return align === "center" || align === "right" ? align : undefined;
};

/** Normal is the default, so it reads back as absent. */
export const blockSizeOf = (el: HTMLElement): RichTextSize | undefined => {
  const size = el.getAttribute(BLOCK_SIZE_ATTR);
  return size === "small" || size === "large" ? size : undefined;
};

/** Top-level block elements, the same set the reader serializes. Block-level
 * commands (list, alignment) operate on these directly. */
export const getBlockElements = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.childNodes).filter(
    (node) =>
      node.nodeType === Node.ELEMENT_NODE &&
      (node as HTMLElement).tagName.toLowerCase() === "div",
  ) as HTMLElement[];

/** Reads a RichTextDocument back out of a contentEditable element previously
 * populated by `renderRichTextIntoElement` (possibly since mutated by the
 * browser's own editing/execCommand). Tolerates a bare, unwrapped text node
 * or <div>/<br> at the top level (what a fresh contentEditable produces
 * before any block wrapper exists) by treating it as a single paragraph. */
export const readRichTextFromElement = (
  container: HTMLElement,
): RichTextDocument => {
  const topLevelBlocks = getBlockElements(container);

  if (topLevelBlocks.length === 0) {
    const spans = mergeAdjacentSpans(
      Array.from(container.childNodes).flatMap((child) =>
        collectSpansFromInlineNode(child, {}),
      ),
    );
    return spans.length
      ? { blocks: [{ type: "paragraph", spans }] }
      : { blocks: [] };
  }

  const blocks = topLevelBlocks.map((blockEl) => {
    const align = blockAlignOf(blockEl);
    const size = blockSizeOf(blockEl);
    return {
      type: blockTypeOf(blockEl),
      ...(align ? { align } : {}),
      ...(size ? { size } : {}),
      spans: mergeAdjacentSpans(
        Array.from(blockEl.childNodes).flatMap((child) =>
          collectSpansFromInlineNode(child, {}),
        ),
      ),
    };
  });

  return { blocks: blocks.filter((block) => block.spans.length > 0) };
};
