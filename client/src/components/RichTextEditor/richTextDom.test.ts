import {
  prepareRichTextColorsForBrowserCommand,
  readRichTextFromElement,
  renderRichTextIntoElement,
  resolveAuthoredRichTextColorFromElement,
} from "./richTextDom";
import { applyReadableRichTextColorToElement } from "../../utils/richTextColorContrast";
import type { RichTextDocument } from "../../types/richText";

const makeContainer = () => document.createElement("div");

describe("renderRichTextIntoElement / readRichTextFromElement round-trip", () => {
  it("round-trips a plain paragraph", () => {
    const doc: RichTextDocument = {
      blocks: [{ type: "paragraph", spans: [{ text: "Welcome everyone" }] }],
    };
    const el = makeContainer();
    renderRichTextIntoElement(el, doc);
    expect(readRichTextFromElement(el)).toEqual(doc);
  });

  it("round-trips bold/italic/underline formatting", () => {
    const doc: RichTextDocument = {
      blocks: [
        {
          type: "paragraph",
          spans: [
            { text: "Plain " },
            { text: "bold", bold: true },
            { text: " and " },
            { text: "italic-underline", italic: true, underline: true },
          ],
        },
      ],
    };
    const el = makeContainer();
    renderRichTextIntoElement(el, doc);
    expect(readRichTextFromElement(el)).toEqual(doc);
  });

  it("round-trips a colored span as hex, not the browser's rgb() form", () => {
    const doc: RichTextDocument = {
      blocks: [
        {
          type: "paragraph",
          spans: [
            { text: "Plain " },
            { text: "red bold", bold: true, color: "#ef4444" },
          ],
        },
      ],
    };
    const el = makeContainer();
    renderRichTextIntoElement(el, doc);
    // Regression: browsers normalize `style.color` to `rgb(...)` when read
    // back, and the server's rich-text validator only accepts `#rrggbb` — an
    // un-normalized value was silently dropped, losing the operator's color.
    expect(readRichTextFromElement(el)).toEqual(doc);
  });

  it("round-trips low-contrast chip colors as the authored hue, not chip ink", () => {
    const doc: RichTextDocument = {
      blocks: [
        {
          type: "paragraph",
          spans: [
            { text: "Black", color: "#000000" },
            { text: " then " },
            { text: "Blue", color: "#1d4ed8" },
          ],
        },
      ],
    };
    const el = makeContainer();
    renderRichTextIntoElement(el, doc);
    // Near-black chips paint white ink into style.color; commits must still
    // keep the operator's colors or the first word reverts to white.
    expect(readRichTextFromElement(el)).toEqual(doc);
  });

  it("keeps authored chip colors when contrast decoration runs again", () => {
    const doc: RichTextDocument = {
      blocks: [
        {
          type: "paragraph",
          spans: [
            { text: "Black", color: "#000000" },
            { text: " " },
            { text: "Blue", color: "#1d4ed8" },
          ],
        },
      ],
    };
    const el = makeContainer();
    renderRichTextIntoElement(el, doc);

    // Simulate coloring a second word: re-decorate every colored node the way
    // the editor does after foreColor (must not treat white ink as authored).
    el.querySelectorAll("span").forEach((node) => {
      const hex = resolveAuthoredRichTextColorFromElement(node);
      if (hex) applyReadableRichTextColorToElement(node, hex);
    });

    expect(readRichTextFromElement(el)).toEqual(doc);
  });

  it("clears stale chip metadata before recoloring an existing word", () => {
    const el = makeContainer();
    renderRichTextIntoElement(el, {
      blocks: [
        {
          type: "paragraph",
          spans: [{ text: "Black", color: "#000000" }],
        },
      ],
    });

    prepareRichTextColorsForBrowserCommand(el);
    const coloredSpan = el.querySelector<HTMLElement>("span");
    expect(coloredSpan).not.toBeNull();
    expect(coloredSpan?.getAttribute("data-rich-text-color")).toBeNull();

    // Simulate execCommand changing the selected span after preparation.
    if (coloredSpan) {
      coloredSpan.style.color = "#2563eb";
      const nextColor = resolveAuthoredRichTextColorFromElement(coloredSpan);
      if (nextColor)
        applyReadableRichTextColorToElement(coloredSpan, nextColor);
    }

    expect(readRichTextFromElement(el)).toEqual({
      blocks: [
        {
          type: "paragraph",
          spans: [{ text: "Black", color: "#2563eb" }],
        },
      ],
    });
  });

  it("reads a legacy <font color> element (execCommand without styleWithCSS)", () => {
    const el = makeContainer();
    const block = document.createElement("div");
    block.setAttribute("data-block-type", "paragraph");
    const font = document.createElement("font");
    font.setAttribute("color", "#22c55e");
    font.appendChild(document.createTextNode("Green"));
    block.appendChild(font);
    el.appendChild(block);

    expect(readRichTextFromElement(el)).toEqual({
      blocks: [
        { type: "paragraph", spans: [{ text: "Green", color: "#22c55e" }] },
      ],
    });
  });

  it("drops an unrecognized color rather than storing an invalid one", () => {
    const el = makeContainer();
    const block = document.createElement("div");
    block.setAttribute("data-block-type", "paragraph");
    const span = document.createElement("span");
    span.setAttribute("style", "color: color-mix(in srgb, red, blue)");
    span.appendChild(document.createTextNode("Exotic"));
    block.appendChild(span);
    el.appendChild(block);

    expect(readRichTextFromElement(el)).toEqual({
      blocks: [{ type: "paragraph", spans: [{ text: "Exotic" }] }],
    });
  });

  it("round-trips block alignment, leaving left as no alignment at all", () => {
    const doc: RichTextDocument = {
      blocks: [
        { type: "paragraph", spans: [{ text: "Centered" }], align: "center" },
        {
          type: "list-item",
          spans: [{ text: "Right bullet" }],
          align: "right",
        },
        { type: "paragraph", spans: [{ text: "Default" }] },
      ],
    };
    const el = makeContainer();
    renderRichTextIntoElement(el, doc);
    const read = readRichTextFromElement(el);

    expect(read).toEqual(doc);
    // Left is the default, so it must not round-trip as an explicit value.
    expect(read.blocks[2]).not.toHaveProperty("align");
  });

  it("round-trips block size, leaving normal as no size at all", () => {
    const doc: RichTextDocument = {
      blocks: [
        { type: "paragraph", spans: [{ text: "Big" }], size: "large" },
        { type: "list-item", spans: [{ text: "Fine print" }], size: "small" },
        { type: "paragraph", spans: [{ text: "Default" }] },
      ],
    };
    const el = makeContainer();
    renderRichTextIntoElement(el, doc);
    const read = readRichTextFromElement(el);

    expect(read).toEqual(doc);
    expect(read.blocks[2]).not.toHaveProperty("size");
  });

  it("round-trips size and alignment together on one block", () => {
    const doc: RichTextDocument = {
      blocks: [
        {
          type: "paragraph",
          spans: [{ text: "Big and centered", bold: true }],
          align: "center",
          size: "large",
        },
      ],
    };
    const el = makeContainer();
    renderRichTextIntoElement(el, doc);
    expect(readRichTextFromElement(el)).toEqual(doc);
  });

  it("round-trips multiple blocks, including list items", () => {
    const doc: RichTextDocument = {
      blocks: [
        { type: "paragraph", spans: [{ text: "Intro line" }] },
        { type: "list-item", spans: [{ text: "First point" }] },
        { type: "list-item", spans: [{ text: "Second point", bold: true }] },
      ],
    };
    const el = makeContainer();
    renderRichTextIntoElement(el, doc);
    expect(readRichTextFromElement(el)).toEqual(doc);
  });

  it("renders an empty document as one empty paragraph block, but reads it back as empty", () => {
    const el = makeContainer();
    renderRichTextIntoElement(el, { blocks: [] });
    expect(el.children).toHaveLength(1);
    expect(readRichTextFromElement(el)).toEqual({ blocks: [] });
  });

  it("merges adjacent spans with identical formatting", () => {
    const el = makeContainer();
    const block = document.createElement("div");
    block.setAttribute("data-block-type", "paragraph");
    const strongA = document.createElement("strong");
    strongA.appendChild(document.createTextNode("Hello "));
    const strongB = document.createElement("strong");
    strongB.appendChild(document.createTextNode("world"));
    block.appendChild(strongA);
    block.appendChild(strongB);
    el.appendChild(block);

    expect(readRichTextFromElement(el)).toEqual({
      blocks: [
        { type: "paragraph", spans: [{ text: "Hello world", bold: true }] },
      ],
    });
  });

  it("treats a bare top-level text node (no block wrapper yet) as one paragraph", () => {
    const el = makeContainer();
    el.appendChild(document.createTextNode("Typed before any block wrapper"));
    expect(readRichTextFromElement(el)).toEqual({
      blocks: [
        {
          type: "paragraph",
          spans: [{ text: "Typed before any block wrapper" }],
        },
      ],
    });
  });
});
