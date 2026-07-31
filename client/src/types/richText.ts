/**
 * Minimal structured rich text: plain data, never HTML. Used for ServicePlan
 * element titles/notes so formatting (bold/italic/underline, paragraphs and
 * lists) can be expressed without an HTML injection surface.
 *
 * This shape intentionally mirrors `ServiceFlowRichText`
 * (client/src/services/serviceFlowTypes.ts) — that's the public,
 * read-only "order of service" share/display feature ServicePlan is meant to
 * eventually publish into, so keeping the shapes identical means no
 * translation step is needed when that bridge is built.
 */
export type RichTextSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
};

/** Left is the default and is stored as an absent `align`, the same way marks
 * omit `false` — so an ordinary paragraph carries no extra fields. */
export type RichTextAlign = "left" | "center" | "right";

/**
 * Size is a whole-block choice from a fixed set, not a free inline font size.
 * Notes render inside a designed public page (see ServiceFlowRichText), so a
 * constrained scale keeps operator-authored text from breaking that design.
 * Normal is the default and stored as an absent `size`.
 */
export type RichTextSize = "small" | "large";
export type RichTextListStyle = "bullet" | "ordered";

export const MAX_RICH_TEXT_LIST_INDENT = 4;

export type RichTextBlock = {
  type: "paragraph" | "list-item";
  align?: RichTextAlign;
  size?: RichTextSize;
  /** Legacy list items omit this and render as bullets. */
  listStyle?: RichTextListStyle;
  /** Zero/absent is the top list level. */
  indent?: number;
  /** Ordered-list restart value; absent means continue or start at 1. */
  listStart?: number;
  spans: RichTextSpan[];
};

export type RichTextDocument = {
  blocks: RichTextBlock[];
};

export const EMPTY_RICH_TEXT: RichTextDocument = { blocks: [] };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_SPAN_LENGTH = 4000;

const normalizeSpan = (raw: unknown): RichTextSpan | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const text =
    typeof record.text === "string" && record.text.length
      ? record.text.slice(0, MAX_SPAN_LENGTH)
      : "";
  if (!text) return null;
  const color =
    typeof record.color === "string" && HEX_COLOR.test(record.color)
      ? record.color.toLowerCase()
      : undefined;
  return {
    text,
    ...(record.bold === true ? { bold: true } : {}),
    ...(record.italic === true ? { italic: true } : {}),
    ...(record.underline === true ? { underline: true } : {}),
    ...(color ? { color } : {}),
  };
};

/**
 * Matches server `normalizeRichTextDocument` so editor emits and autosave
 * echoes share one shape — otherwise a normalized echo fails equality and
 * TipTap `setContent` resets the caret mid-edit.
 */
export const normalizeRichTextDocument = (
  raw: RichTextDocument | undefined | null | unknown,
): RichTextDocument => {
  const blocks = Array.isArray((raw as { blocks?: unknown })?.blocks)
    ? ((raw as { blocks: unknown[] }).blocks)
    : [];
  const normalizedBlocks = blocks
    .map((block): RichTextBlock | null => {
      if (!block || typeof block !== "object" || Array.isArray(block)) {
        return null;
      }
      const record = block as Record<string, unknown>;
      const type = record.type === "list-item" ? "list-item" : "paragraph";
      const align =
        record.align === "center" || record.align === "right"
          ? record.align
          : undefined;
      const size =
        record.size === "small" || record.size === "large"
          ? record.size
          : undefined;
      const listStyle =
        type === "list-item" &&
        (record.listStyle === "bullet" || record.listStyle === "ordered")
          ? record.listStyle
          : undefined;
      const rawIndent = Number(record.indent);
      const indent =
        type === "list-item" && Number.isInteger(rawIndent)
          ? Math.max(0, Math.min(MAX_RICH_TEXT_LIST_INDENT, rawIndent))
          : 0;
      const rawListStart = Number(record.listStart);
      const listStart =
        type === "list-item" &&
        listStyle === "ordered" &&
        Number.isInteger(rawListStart) &&
        rawListStart > 0
          ? Math.min(1000, rawListStart)
          : undefined;
      const spans = (Array.isArray(record.spans) ? record.spans : [])
        .map(normalizeSpan)
        .filter((span): span is RichTextSpan => Boolean(span));
      const hasText = spans.some((span) => span.text.trim());
      if (type === "list-item" && !hasText) return null;
      return {
        type,
        ...(align ? { align } : {}),
        ...(size ? { size } : {}),
        ...(listStyle ? { listStyle } : {}),
        ...(indent ? { indent } : {}),
        ...(listStart && listStart !== 1 ? { listStart } : {}),
        spans: hasText ? spans : [],
      };
    })
    .filter((block): block is RichTextBlock => Boolean(block));

  while (
    normalizedBlocks[0]?.type === "paragraph" &&
    normalizedBlocks[0].spans.length === 0
  ) {
    normalizedBlocks.shift();
  }
  while (
    normalizedBlocks.at(-1)?.type === "paragraph" &&
    normalizedBlocks.at(-1)!.spans.length === 0
  ) {
    normalizedBlocks.pop();
  }
  return { blocks: normalizedBlocks };
};

export const isRichTextEmpty = (
  doc: RichTextDocument | undefined | null,
): boolean =>
  !doc ||
  doc.blocks.every((block) => block.spans.every((span) => !span.text.trim()));

export const richTextToPlainText = (
  doc: RichTextDocument | undefined | null,
): string =>
  !doc
    ? ""
    : doc.blocks
        .map((block) => block.spans.map((span) => span.text).join(""))
        .join("\n");

/** Plain-text notes that retain list markers and nesting for integrations that
 * cannot carry the structured document. Titles and matching continue to use
 * `richTextToPlainText`, where structural prefixes would be incorrect. */
export const richTextToFormattedPlainText = (
  doc: RichTextDocument | undefined | null,
): string => {
  if (!doc) return "";
  const orderedCounters = new Map<number, number>();
  return doc.blocks
    .map((block) => {
      const text = block.spans.map((span) => span.text).join("");
      if (block.type !== "list-item") {
        orderedCounters.clear();
        return text;
      }
      const indent = Math.max(
        0,
        Math.min(MAX_RICH_TEXT_LIST_INDENT, block.indent || 0),
      );
      const style = block.listStyle === "ordered" ? "ordered" : "bullet";
      Array.from(orderedCounters.keys())
        .filter((depth) => depth > indent)
        .forEach((depth) => orderedCounters.delete(depth));
      let marker = "-";
      if (style === "ordered") {
        const value =
          block.listStart ||
          (orderedCounters.has(indent)
            ? (orderedCounters.get(indent) || 0) + 1
            : 1);
        orderedCounters.set(indent, value);
        marker = `${value}.`;
      } else {
        orderedCounters.delete(indent);
      }
      return `${"  ".repeat(indent)}${marker} ${text}`;
    })
    .join("\n");
};

/** Wraps a single plain string into a one-paragraph rich text document. */
export const plainTextToRichText = (text: string): RichTextDocument =>
  text
    ? { blocks: [{ type: "paragraph", spans: [{ text }] }] }
    : { blocks: [] };

const LIST_ITEM_MARKER = /^([ \t]*)(?:([-*•])|(\d+)[.)])\s+/;

const listIndentFromWhitespace = (whitespace: string): number =>
  Math.min(
    MAX_RICH_TEXT_LIST_INDENT,
    Math.floor(whitespace.replace(/\t/g, "  ").length / 2),
  );

/**
 * Wraps plain text into rich text with one block per line. The block list is
 * how this model expresses line structure, and blocks survive an edit round
 * trip through the editor's contenteditable, where a raw "\n" inside a span
 * would not. Lines opening with a bullet marker become list items — the
 * renderer draws its own bullet, so the marker itself is dropped.
 */
export const multilineTextToRichText = (text: string): RichTextDocument => {
  const blocks: RichTextBlock[] = [];
  let previousOrdered: { indent: number; value: number } | undefined;

  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((line) => {
      const marker = line.match(LIST_ITEM_MARKER);
      if (!marker) {
        blocks.push({
          type: "paragraph",
          spans: line ? [{ text: line }] : [],
        });
        previousOrdered = undefined;
        return;
      }

      const indent = listIndentFromWhitespace(marker[1]);
      const orderedValue = marker[3] ? Number(marker[3]) : undefined;
      const content = line.slice(marker[0].length);
      const continuesOrderedList =
        orderedValue !== undefined &&
        previousOrdered?.indent === indent &&
        previousOrdered.value + 1 === orderedValue;
      blocks.push({
        type: "list-item",
        ...(orderedValue !== undefined
          ? { listStyle: "ordered" as const }
          : {}),
        ...(indent ? { indent } : {}),
        ...(orderedValue !== undefined &&
        !continuesOrderedList &&
        orderedValue !== 1
          ? { listStart: orderedValue }
          : {}),
        spans: content ? [{ text: content }] : [],
      });
      previousOrdered =
        orderedValue === undefined
          ? undefined
          : { indent, value: orderedValue };
    });

  while (
    blocks[0]?.type === "paragraph" &&
    isRichTextEmpty({ blocks: [blocks[0]] })
  ) {
    blocks.shift();
  }
  while (
    blocks.at(-1)?.type === "paragraph" &&
    isRichTextEmpty({ blocks: [blocks.at(-1)!] })
  ) {
    blocks.pop();
  }
  return { blocks };
};
