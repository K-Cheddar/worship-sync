import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRichTextDocument } from "./serviceFlowService.js";

test("rich text only keeps supported styles and hex colors", () => {
  assert.deepEqual(
    normalizeRichTextDocument({ blocks: [{ type: "heading", spans: [
      { text: "  Blue mic  ", color: "#0088FF", italic: true, href: "https://bad.test" },
      { text: "", color: "#ff0000" },
    ] }] }),
    { blocks: [{ type: "paragraph", spans: [{ text: "  Blue mic  ", color: "#0088ff", italic: true }] }] },
  );
});

test("rich text keeps center/right alignment and drops anything else", () => {
  assert.deepEqual(
    normalizeRichTextDocument({ blocks: [
      { type: "paragraph", align: "center", spans: [{ text: "Centered" }] },
      { type: "list-item", align: "right", spans: [{ text: "Bullet" }] },
      // Left is the default, so it is stored as no alignment at all.
      { type: "paragraph", align: "left", spans: [{ text: "Default" }] },
      { type: "paragraph", align: "justify", spans: [{ text: "Unsupported" }] },
    ] }),
    { blocks: [
      { type: "paragraph", align: "center", spans: [{ text: "Centered" }] },
      { type: "list-item", align: "right", spans: [{ text: "Bullet" }] },
      { type: "paragraph", spans: [{ text: "Default" }] },
      { type: "paragraph", spans: [{ text: "Unsupported" }] },
    ] },
  );
});

test("rich text keeps the fixed size scale and drops anything outside it", () => {
  assert.deepEqual(
    normalizeRichTextDocument({ blocks: [
      { type: "paragraph", size: "large", spans: [{ text: "Headline" }] },
      { type: "list-item", size: "small", spans: [{ text: "Fine print" }] },
      // Normal is the default, so it is stored as no size at all.
      { type: "paragraph", size: "normal", spans: [{ text: "Body" }] },
      // A free font size must not survive into the public page's type scale.
      { type: "paragraph", size: "72px", spans: [{ text: "Huge" }] },
    ] }),
    { blocks: [
      { type: "paragraph", size: "large", spans: [{ text: "Headline" }] },
      { type: "list-item", size: "small", spans: [{ text: "Fine print" }] },
      { type: "paragraph", spans: [{ text: "Body" }] },
      { type: "paragraph", spans: [{ text: "Huge" }] },
    ] },
  );
});

test("rich text keeps meaningful whitespace between adjacent spans", () => {
  assert.deepEqual(
    normalizeRichTextDocument({ blocks: [{ spans: [
      { text: "Red " },
      { text: "mic", color: "#ff0000" },
    ] }] }),
    { blocks: [{ type: "paragraph", spans: [
      { text: "Red " },
      { text: "mic", color: "#ff0000" },
    ] }] },
  );
});
