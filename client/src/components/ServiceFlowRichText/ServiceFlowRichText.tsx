import type {
  ServiceFlowRichText as ServiceFlowRichTextDocument,
  ServiceFlowTextSpan,
} from "../../services/serviceFlowTypes";
import {
  RICH_TEXT_COLOR_ATTR,
  normalizeHexColor,
  readableRichTextColorStyle,
} from "../../utils/richTextColorContrast";

/** A fixed scale rather than an author-supplied font size, so notes stay
 * within the public page's type system. Base is the container's `text-sm`. */
const SIZE_CLASS = {
  small: "text-xs",
  normal: "",
  large: "text-base",
} as const;

type ServiceFlowBlock = ServiceFlowRichTextDocument["blocks"][number];

const spanContents = (
  spans: ServiceFlowTextSpan[],
  blockIndex: number,
) =>
  spans.map((span, spanIndex) => {
    const authoredColor = normalizeHexColor(span.color);
    return (
      <span
        key={`${blockIndex}-${spanIndex}`}
        className={[
          span.bold ? "font-bold" : "",
          span.italic ? "italic" : "",
          span.underline ? "underline underline-offset-2" : "",
        ].filter(Boolean).join(" ")}
        {...(authoredColor
          ? { [RICH_TEXT_COLOR_ATTR]: authoredColor }
          : {})}
        style={readableRichTextColorStyle(span.color)}
      >
        {span.text}
      </span>
    );
  });

const blockText = (block: ServiceFlowBlock, blockIndex: number) => {
  const style = block.align ? { textAlign: block.align } : undefined;
  const sizeClass = SIZE_CLASS[block.size ?? "normal"];
  return (
    <p
      className={`whitespace-pre-wrap ${sizeClass}`}
      style={style}
    >
      {block.spans.length ? spanContents(block.spans, blockIndex) : <br aria-hidden />}
    </p>
  );
};

type ListTreeItem = {
  block: ServiceFlowBlock | null;
  blockIndex: number;
  children: ListTree[];
};

type ListTree = {
  style: "bullet" | "ordered";
  start?: number;
  items: ListTreeItem[];
};

/**
 * Nest one level at a time so indent gaps (0 → 2) keep their depth. Empty
 * intermediate items are structural placeholders and render without a marker.
 */
const parseList = (
  blocks: ServiceFlowBlock[],
  startIndex: number,
  indent: number,
  listStyle: "bullet" | "ordered",
): { tree: ListTree; nextIndex: number } => {
  const firstBlock = blocks[startIndex];
  const tree: ListTree = {
    style: listStyle,
    ...(listStyle === "ordered" &&
      (firstBlock.indent || 0) === indent &&
      firstBlock.listStart
      ? { start: firstBlock.listStart }
      : {}),
    items: [],
  };
  let index = startIndex;
  while (index < blocks.length) {
    const block = blocks[index];
    if (block.type !== "list-item") break;
    const blockIndent = Math.max(0, block.indent || 0);
    const blockStyle = block.listStyle === "ordered" ? "ordered" : "bullet";
    if (blockIndent < indent) break;
    if (blockIndent > indent) {
      let parent = tree.items.at(-1);
      if (!parent) {
        parent = { block: null, blockIndex: index, children: [] };
        tree.items.push(parent);
      }
      const nested = parseList(blocks, index, indent + 1, blockStyle);
      parent.children.push(nested.tree);
      index = nested.nextIndex;
      continue;
    }
    if (blockStyle !== listStyle) break;
    if (
      index !== startIndex &&
      listStyle === "ordered" &&
      block.listStart
    ) {
      break;
    }
    tree.items.push({ block, blockIndex: index, children: [] });
    index += 1;
  }
  return { tree, nextIndex: index };
};

const RichTextList = ({
  tree,
  nested = false,
}: {
  tree: ListTree;
  nested?: boolean;
}) => {
  const ListTag = tree.style === "ordered" ? "ol" : "ul";
  return (
    <ListTag
      className={[
        tree.style === "ordered" ? "list-decimal" : "list-disc",
        nested ? "mt-1 pl-5" : "pl-5",
      ].join(" ")}
      {...(tree.style === "ordered" && tree.start ? { start: tree.start } : {})}
    >
      {tree.items.map((item) => (
        <li
          key={item.blockIndex}
          className={item.block ? undefined : "list-none"}
        >
          {item.block ? blockText(item.block, item.blockIndex) : null}
          {item.children.map((child, childIndex) => (
            <RichTextList
              key={`${item.blockIndex}-${childIndex}`}
              tree={child}
              nested
            />
          ))}
        </li>
      ))}
    </ListTag>
  );
};

/** Renders only structured text spans; it never receives or injects HTML. */
const ServiceFlowRichText = ({ document }: { document: ServiceFlowRichTextDocument }) => {
  if (!document.blocks.length) return null;

  const renderedBlocks = [];
  let blockIndex = 0;
  while (blockIndex < document.blocks.length) {
    const block = document.blocks[blockIndex];
    if (block.type === "paragraph") {
      renderedBlocks.push(
        <div key={blockIndex}>{blockText(block, blockIndex)}</div>,
      );
      blockIndex += 1;
      continue;
    }
    const listStyle = block.listStyle === "ordered" ? "ordered" : "bullet";
    const parsed = parseList(document.blocks, blockIndex, 0, listStyle);
    renderedBlocks.push(
      <RichTextList key={blockIndex} tree={parsed.tree} />,
    );
    blockIndex = parsed.nextIndex;
  }

  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-white">
      {renderedBlocks}
    </div>
  );
};

export default ServiceFlowRichText;
