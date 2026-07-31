const MAX_SPAN_LENGTH = 4000;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/** Left is the default and is represented by an absent `align`, so only the
 * two non-default values are accepted. */
const BLOCK_ALIGNMENTS = new Set(["center", "right"]);
/** Normal is the default and is represented by an absent `size`. A fixed
 * scale, so operator-authored notes can't break the public page's type. */
const BLOCK_SIZES = new Set(["small", "large"]);
const LIST_STYLES = new Set(["bullet", "ordered"]);
const MAX_LIST_INDENT = 4;

const cleanText = (value, maxLength) =>
  typeof value === "string" && value.length ? value.slice(0, maxLength) : "";

const normalizeSpan = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const text = cleanText(raw.text, MAX_SPAN_LENGTH);
  if (!text) return null;
  const color =
    typeof raw.color === "string" && HEX_COLOR.test(raw.color)
      ? raw.color.toLowerCase()
      : undefined;
  return {
    text,
    ...(raw.bold === true ? { bold: true } : {}),
    ...(raw.italic === true ? { italic: true } : {}),
    ...(raw.underline === true ? { underline: true } : {}),
    ...(color ? { color } : {}),
  };
};

/** Shared validator for ServicePlan rich text and the public read projection. */
export const normalizeRichTextDocument = (raw) => {
  const blocks = Array.isArray(raw?.blocks) ? raw.blocks : [];
  const normalizedBlocks = blocks
    .map((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block))
        return null;
      const type = block.type === "list-item" ? "list-item" : "paragraph";
      const align = BLOCK_ALIGNMENTS.has(block.align) ? block.align : undefined;
      const size = BLOCK_SIZES.has(block.size) ? block.size : undefined;
      const listStyle =
        type === "list-item" && LIST_STYLES.has(block.listStyle)
          ? block.listStyle
          : undefined;
      const rawIndent = Number(block.indent);
      const indent =
        type === "list-item" && Number.isInteger(rawIndent)
          ? Math.max(0, Math.min(MAX_LIST_INDENT, rawIndent))
          : 0;
      const rawListStart = Number(block.listStart);
      const listStart =
        type === "list-item" &&
        listStyle === "ordered" &&
        Number.isInteger(rawListStart) &&
        rawListStart > 0
          ? Math.min(1000, rawListStart)
          : undefined;
      const spans = (Array.isArray(block.spans) ? block.spans : [])
        .map(normalizeSpan)
        .filter(Boolean);
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
    .filter(Boolean);

  while (
    normalizedBlocks[0]?.type === "paragraph" &&
    normalizedBlocks[0].spans.length === 0
  ) {
    normalizedBlocks.shift();
  }
  while (
    normalizedBlocks.at(-1)?.type === "paragraph" &&
    normalizedBlocks.at(-1).spans.length === 0
  ) {
    normalizedBlocks.pop();
  }
  return { blocks: normalizedBlocks };
};
