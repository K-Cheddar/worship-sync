import type { Box, SlideTextDocument, SlideTextSpan } from "../types";

export type SlideTextFallbackStyle = Pick<
  SlideTextSpan,
  "bold" | "italic" | "color" | "fontSizePx"
> & { align?: "left" | "center" | "right" };

const normalizeSpan = (value: unknown): SlideTextSpan | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.text !== "string") return null;
  const fontSizePx =
    typeof raw.fontSizePx === "number" &&
    Number.isFinite(raw.fontSizePx) &&
    raw.fontSizePx > 0
      ? raw.fontSizePx
      : undefined;
  return {
    text: raw.text,
    ...(raw.bold === true ? { bold: true } : {}),
    ...(raw.italic === true ? { italic: true } : {}),
    ...(typeof raw.color === "string" ? { color: raw.color } : {}),
    ...(fontSizePx !== undefined ? { fontSizePx } : {}),
  };
};

/** Returns the supported presentation fields in a stable plain-data shape. */
export const normalizeSlideTextDocument = (
  value: SlideTextDocument | null | undefined | unknown,
): SlideTextDocument => {
  const rawBlocks =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { blocks?: unknown }).blocks
      : undefined;
  if (!Array.isArray(rawBlocks)) return { blocks: [] };

  return {
    blocks: rawBlocks.flatMap((rawBlock) => {
      if (!rawBlock || typeof rawBlock !== "object" || Array.isArray(rawBlock)) {
        return [];
      }
      const block = rawBlock as Record<string, unknown>;
      const align =
        block.align === "center" || block.align === "right"
          ? block.align
          : undefined;
      const spans = (Array.isArray(block.spans) ? block.spans : [])
        .map(normalizeSpan)
        .filter((span): span is SlideTextSpan => Boolean(span?.text));
      return [{ ...(align ? { align } : {}), spans }];
    }),
  };
};

export const plainTextToSlideTextDocument = (
  text: string,
  fallbackStyle?: SlideTextFallbackStyle,
): SlideTextDocument => {
  if (!text) return { blocks: [] };
  const makeSpan = (line: string): SlideTextSpan => ({
    text: line,
    ...(fallbackStyle?.bold ? { bold: true } : {}),
    ...(fallbackStyle?.italic ? { italic: true } : {}),
    ...(typeof fallbackStyle?.color === "string"
      ? { color: fallbackStyle.color }
      : {}),
    ...(typeof fallbackStyle?.fontSizePx === "number" &&
    Number.isFinite(fallbackStyle.fontSizePx) &&
    fallbackStyle.fontSizePx > 0
      ? { fontSizePx: fallbackStyle.fontSizePx }
      : {}),
  });
  return {
    blocks: text.split("\n").map((line) => ({
      ...(fallbackStyle?.align === "center" || fallbackStyle?.align === "right"
        ? { align: fallbackStyle.align }
        : {}),
      spans: line ? [makeSpan(line)] : [],
    })),
  };
};

export const slideTextDocumentToPlainText = (
  document: SlideTextDocument | null | undefined,
): string =>
  normalizeSlideTextDocument(document).blocks
    .map((block) => block.spans.map((span) => span.text).join(""))
    .join("\n");

export const getBoxPlainText = (box: Box): string =>
  box.textDocument != null
    ? slideTextDocumentToPlainText(box.textDocument)
    : box.words ?? "";

/**
 * Identity for text-driven display comparisons. Adjacent spans with matching
 * styles and omitted/default fields compare the same, while formatting changes
 * remain visible even when the plain words are unchanged.
 */
export const getBoxTextVisualIdentity = (box: Box): string => {
  const document =
    box.textDocument == null
      ? undefined
      : normalizeSlideTextDocument(box.textDocument).blocks.map((block) => ({
          align: block.align || "left",
          spans: block.spans.reduce<Array<{
            text: string;
            bold: boolean;
            italic: boolean;
            color: string;
            fontSizePx: number | null;
          }>>((result, span) => {
            const next = {
              text: span.text.replace(/\r\n?/g, "\n"),
              bold: Boolean(span.bold),
              italic: Boolean(span.italic),
              color: span.color || "",
              fontSizePx: span.fontSizePx ?? null,
            };
            const previous = result.at(-1);
            if (
              previous &&
              previous.bold === next.bold &&
              previous.italic === next.italic &&
              previous.color === next.color &&
              previous.fontSizePx === next.fontSizePx
            ) {
              previous.text += next.text;
            } else {
              result.push(next);
            }
            return result;
          }, []),
        }));

  return JSON.stringify({
    words: box.words,
    document,
    width: box.width,
    height: box.height,
    x: box.x,
    y: box.y,
    fontSize: box.fontSize,
    align: box.align,
    isBold: box.isBold,
    isItalic: box.isItalic,
    fontColor: box.fontColor,
    brightness: box.brightness,
    topMargin: box.topMargin,
    sideMargin: box.sideMargin,
    transparent: box.transparent,
    label: box.label,
    monitorFontSizePx: box.monitorFontSizePx,
  });
};
