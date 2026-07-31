import { Extension } from "@tiptap/core";
import { Color } from "@tiptap/extension-color";
import {
  RICH_TEXT_COLOR_ATTR,
  authoredColorFromElement,
  normalizeHexColor,
  readableRichTextColorStyle,
} from "../../utils/richTextColorContrast";
import type { RichTextSize } from "../../types/richText";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockSize: {
      setBlockSize: (size: RichTextSize | null) => ReturnType;
    };
  }
}

export const BlockSize = Extension.create({
  name: "blockSize",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          blockSize: {
            default: null,
            parseHTML: (element) => {
              const size = element.getAttribute("data-block-size");
              return size === "small" || size === "large" ? size : null;
            },
            renderHTML: (attributes) =>
              attributes.blockSize
                ? { "data-block-size": attributes.blockSize }
                : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setBlockSize:
        (size) =>
        ({ commands }) =>
          commands.updateAttributes("paragraph", { blockSize: size }),
    };
  },
});

const styleDeclarations = (
  style: ReturnType<typeof readableRichTextColorStyle>,
) =>
  [
    style.color ? `color: ${style.color}` : "",
    style.backgroundColor ? `background-color: ${style.backgroundColor}` : "",
    style.borderRadius ? `border-radius: ${style.borderRadius}` : "",
    style.padding ? `padding: ${style.padding}` : "",
    style.boxShadow ? `box-shadow: ${style.boxShadow}` : "",
  ]
    .filter(Boolean)
    .join("; ");

/**
 * TipTap keeps the authored color in editor state while rendering the same
 * low-contrast safety chip used by the public note surface.
 */
export const ReadableColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          color: {
            default: null,
            parseHTML: (element) => authoredColorFromElement(element),
            renderHTML: (attributes) => {
              const color = normalizeHexColor(attributes.color);
              if (!color) return {};
              return {
                [RICH_TEXT_COLOR_ATTR]: color,
                style: styleDeclarations(readableRichTextColorStyle(color)),
              };
            },
          },
        },
      },
    ];
  },
});
