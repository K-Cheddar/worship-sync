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

export type RichTextBlock = {
  type: "paragraph" | "list-item";
  align?: RichTextAlign;
  size?: RichTextSize;
  spans: RichTextSpan[];
};

export type RichTextDocument = {
  blocks: RichTextBlock[];
};

export const EMPTY_RICH_TEXT: RichTextDocument = { blocks: [] };

export const isRichTextEmpty = (doc: RichTextDocument | undefined | null): boolean =>
  !doc || doc.blocks.every((block) => block.spans.every((span) => !span.text.trim()));

export const richTextToPlainText = (doc: RichTextDocument | undefined | null): string =>
  !doc
    ? ""
    : doc.blocks
        .map((block) => block.spans.map((span) => span.text).join(""))
        .join("\n");

/** Wraps a single plain string into a one-paragraph rich text document. */
export const plainTextToRichText = (text: string): RichTextDocument =>
  text
    ? { blocks: [{ type: "paragraph", spans: [{ text }] }] }
    : { blocks: [] };
