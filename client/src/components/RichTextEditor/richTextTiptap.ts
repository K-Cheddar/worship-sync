import type { JSONContent } from "@tiptap/core";
import {
  MAX_RICH_TEXT_LIST_INDENT,
  type RichTextBlock,
  type RichTextDocument,
  type RichTextSpan,
} from "../../types/richText";

type InlineFormatting = Omit<RichTextSpan, "text">;

const toHexPair = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");

export const normalizeTiptapColorToHex = (raw: unknown): string | undefined => {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase();
  const shortHex = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (shortHex) {
    const [, red, green, blue] = shortHex;
    return `#${red}${red}${green}${green}${blue}${blue}`;
  }
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  const rgb = value.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*[\d.%]+\s*)?\)$/,
  );
  if (!rgb) return undefined;
  const [, red, green, blue] = rgb;
  return `#${toHexPair(Number(red))}${toHexPair(Number(green))}${toHexPair(Number(blue))}`;
};

const marksForSpan = (span: RichTextSpan): JSONContent["marks"] => [
  ...(span.bold ? [{ type: "bold" }] : []),
  ...(span.italic ? [{ type: "italic" }] : []),
  ...(span.underline ? [{ type: "underline" }] : []),
  ...(span.color
    ? [{ type: "textStyle", attrs: { color: span.color.toLowerCase() } }]
    : []),
];

const inlineContentForSpans = (spans: RichTextSpan[]): JSONContent[] => {
  const content: JSONContent[] = [];
  spans.forEach((span) => {
    const parts = span.text.split("\n");
    parts.forEach((part, index) => {
      if (part) {
        content.push({
          type: "text",
          text: part,
          marks: marksForSpan(span),
        });
      }
      if (index < parts.length - 1) {
        content.push({ type: "hardBreak", marks: marksForSpan(span) });
      }
    });
  });
  return content;
};

const paragraphForBlock = (block: RichTextBlock): JSONContent => ({
  type: "paragraph",
  attrs: {
    textAlign: block.align || "left",
    blockSize: block.size || null,
  },
  ...(block.spans.length
    ? { content: inlineContentForSpans(block.spans) }
    : {}),
});

const emptyParagraph = (): JSONContent => ({ type: "paragraph" });

const emptyListItem = (): JSONContent => ({
  type: "listItem",
  content: [emptyParagraph()],
});

type ParsedList = {
  node: JSONContent;
  nextIndex: number;
};

/**
 * Build TipTap lists one DOM nesting level at a time. Indent gaps (e.g. 0 → 2)
 * get empty intermediate list items so flatten can recover the original depth;
 * those placeholders are structural only and never stored in the flat model.
 */
const parseList = (
  blocks: RichTextBlock[],
  startIndex: number,
  indent: number,
  listStyle: "bullet" | "ordered",
): ParsedList => {
  const items: JSONContent[] = [];
  let index = startIndex;
  const firstBlock = blocks[startIndex];
  const listNode: JSONContent = {
    type: listStyle === "ordered" ? "orderedList" : "bulletList",
    ...(listStyle === "ordered" &&
    (firstBlock.indent || 0) === indent &&
    firstBlock.listStart
      ? { attrs: { start: firstBlock.listStart } }
      : {}),
    content: items,
  };

  while (index < blocks.length) {
    const block = blocks[index];
    if (block.type !== "list-item") break;
    const blockIndent = Math.min(
      MAX_RICH_TEXT_LIST_INDENT,
      Math.max(0, block.indent || 0),
    );
    const blockStyle = block.listStyle === "ordered" ? "ordered" : "bullet";
    if (blockIndent < indent) break;

    if (blockIndent > indent) {
      let parentItem = items.at(-1);
      if (!parentItem) {
        parentItem = emptyListItem();
        items.push(parentItem);
      }
      const nested = parseList(blocks, index, indent + 1, blockStyle);
      parentItem.content = [...(parentItem.content || []), nested.node];
      index = nested.nextIndex;
      continue;
    }
    if (blockStyle !== listStyle) break;
    if (index !== startIndex && listStyle === "ordered" && block.listStart) {
      break;
    }

    items.push({
      type: "listItem",
      content: [paragraphForBlock(block)],
    });
    index += 1;
  }

  return { node: listNode, nextIndex: index };
};

export const richTextDocumentToTiptapContent = (
  document: RichTextDocument,
): JSONContent => {
  const content: JSONContent[] = [];
  let index = 0;
  while (index < document.blocks.length) {
    const block = document.blocks[index];
    if (block.type === "paragraph") {
      content.push(paragraphForBlock(block));
      index += 1;
      continue;
    }
    // Always start at indent 0 so leading indent (and gaps) become nested
    // TipTap structure that flattenList can restore.
    const listStyle = block.listStyle === "ordered" ? "ordered" : "bullet";
    const parsed = parseList(document.blocks, index, 0, listStyle);
    content.push(parsed.node);
    index = parsed.nextIndex;
  }
  return {
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  };
};

const formattingForNode = (node: JSONContent): InlineFormatting => {
  const formatting: InlineFormatting = {};
  (node.marks || []).forEach((mark) => {
    if (mark.type === "bold") formatting.bold = true;
    if (mark.type === "italic") formatting.italic = true;
    if (mark.type === "underline") formatting.underline = true;
    if (mark.type === "textStyle") {
      const color = normalizeTiptapColorToHex(mark.attrs?.color);
      if (color) formatting.color = color;
    }
  });
  return formatting;
};

const sameFormatting = (left: InlineFormatting, right: InlineFormatting) =>
  left.bold === right.bold &&
  left.italic === right.italic &&
  left.underline === right.underline &&
  left.color === right.color;

const appendSpan = (
  spans: RichTextSpan[],
  text: string,
  formatting: InlineFormatting,
) => {
  if (!text) return;
  const previous = spans.at(-1);
  if (previous && sameFormatting(previous, formatting)) {
    previous.text += text;
    return;
  }
  spans.push({ text, ...formatting });
};

const spansForInlineContent = (content: JSONContent[] = []): RichTextSpan[] => {
  const spans: RichTextSpan[] = [];
  content.forEach((node) => {
    if (node.type === "text") {
      appendSpan(spans, node.text || "", formattingForNode(node));
    } else if (node.type === "hardBreak") {
      appendSpan(spans, "\n", formattingForNode(node));
    }
  });
  return spans;
};

const blockAttributes = (
  paragraph: JSONContent | undefined,
): Pick<RichTextBlock, "align" | "size"> => {
  const textAlign = paragraph?.attrs?.textAlign;
  const blockSize = paragraph?.attrs?.blockSize;
  return {
    ...(textAlign === "center" || textAlign === "right"
      ? { align: textAlign }
      : {}),
    ...(blockSize === "small" || blockSize === "large"
      ? { size: blockSize }
      : {}),
  };
};

const flattenList = (
  listNode: JSONContent,
  indent: number,
  blocks: RichTextBlock[],
) => {
  const ordered = listNode.type === "orderedList";
  const start = Number(listNode.attrs?.start);
  (listNode.content || []).forEach((item, itemIndex) => {
    if (item.type !== "listItem") return;
    const paragraphs = (item.content || []).filter(
      (child) => child.type === "paragraph",
    );
    const firstParagraph = paragraphs[0];
    const spans = spansForInlineContent(firstParagraph?.content);
    paragraphs.slice(1).forEach((paragraph) => {
      appendSpan(spans, "\n", {});
      spansForInlineContent(paragraph.content).forEach((span) =>
        appendSpan(spans, span.text, span),
      );
    });
    if (spans.some((span) => span.text.trim())) {
      blocks.push({
        type: "list-item",
        ...blockAttributes(firstParagraph),
        ...(ordered ? { listStyle: "ordered" as const } : {}),
        ...(indent ? { indent } : {}),
        ...(ordered && itemIndex === 0 && Number.isInteger(start) && start > 1
          ? { listStart: Math.min(1000, start) }
          : {}),
        spans,
      });
    }
    (item.content || [])
      .filter(
        (child) => child.type === "bulletList" || child.type === "orderedList",
      )
      .forEach((nestedList) =>
        flattenList(
          nestedList,
          Math.min(MAX_RICH_TEXT_LIST_INDENT, indent + 1),
          blocks,
        ),
      );
  });
};

const isBlankParagraph = (block: RichTextBlock | undefined) =>
  block?.type === "paragraph" && block.spans.every((span) => !span.text.trim());

export const tiptapContentToRichTextDocument = (
  document: JSONContent,
): RichTextDocument => {
  const blocks: RichTextBlock[] = [];
  (document.content || []).forEach((node) => {
    if (node.type === "paragraph") {
      blocks.push({
        type: "paragraph",
        ...blockAttributes(node),
        spans: spansForInlineContent(node.content),
      });
      return;
    }
    if (node.type === "bulletList" || node.type === "orderedList") {
      flattenList(node, 0, blocks);
    }
  });
  while (isBlankParagraph(blocks[0])) blocks.shift();
  while (isBlankParagraph(blocks.at(-1))) blocks.pop();
  return { blocks };
};
