import type { Box } from "../types";
import {
  getBoxPlainText,
  getBoxTextVisualIdentity,
  plainTextToSlideTextDocument,
  slideTextDocumentToPlainText,
} from "./presentationText";

describe("presentation text compatibility", () => {
  it("returns legacy box words unchanged", () => {
    const box: Box = { words: "First line\nSecond line", width: 100, height: 50 };
    expect(getBoxPlainText(box)).toBe("First line\nSecond line");
  });

  it("converts structured blocks and spans to plain text", () => {
    expect(
      slideTextDocumentToPlainText({
        blocks: [
          { spans: [{ text: "Amazing ", bold: true }, { text: "grace" }] },
          { align: "center", spans: [{ text: "How sweet" }] },
        ],
      }),
    ).toBe("Amazing grace\nHow sweet");
  });

  it("converts plain text to a valid structured document without losing text", () => {
    const text = "Welcome\n\nEveryone";
    const document = plainTextToSlideTextDocument(text, {
      color: "rebeccapurple",
      fontSizePx: 72,
      bold: true,
      align: "center",
    });

    expect(document).toEqual({
      blocks: [
        {
          align: "center",
          spans: [
            {
              text: "Welcome",
              bold: true,
              color: "rebeccapurple",
              fontSizePx: 72,
            },
          ],
        },
        { align: "center", spans: [] },
        {
          align: "center",
          spans: [
            {
              text: "Everyone",
              bold: true,
              color: "rebeccapurple",
              fontSizePx: 72,
            },
          ],
        },
      ],
    });
    expect(slideTextDocumentToPlainText(document)).toBe(text);
  });

  it("uses structured text when present", () => {
    expect(
      getBoxPlainText({
        words: "Legacy value",
        textDocument: { blocks: [{ spans: [{ text: "Structured value" }] }] },
        width: 100,
        height: 50,
      }),
    ).toBe("Structured value");
  });

  it("changes text visual identity for formatting-only changes", () => {
    const base: Box = {
      words: "Same words",
      textDocument: { blocks: [{ spans: [{ text: "Same words" }] }] },
      width: 100,
      height: 50,
    };

    expect(
      getBoxTextVisualIdentity({
        ...base,
        textDocument: {
          blocks: [{ spans: [{ text: "Same words", color: "red" }] }],
        },
      }),
    ).not.toBe(getBoxTextVisualIdentity(base));
    expect(
      getBoxTextVisualIdentity({
        ...base,
        textDocument: {
          blocks: [{ spans: [{ text: "Same words", bold: true }] }],
        },
      }),
    ).not.toBe(getBoxTextVisualIdentity(base));
    expect(
      getBoxTextVisualIdentity({
        ...base,
        textDocument: {
          blocks: [{ spans: [{ text: "Same words", fontSizePx: 84 }] }],
        },
      }),
    ).not.toBe(getBoxTextVisualIdentity(base));
  });

  it("keeps identity stable for semantically equivalent structured documents", () => {
    const base: Box = {
      words: "Same words",
      width: 100,
      height: 50,
      textDocument: {
        blocks: [{ spans: [{ text: "Same " }, { text: "words" }] }],
      },
    };
    const equivalent: Box = {
      ...base,
      textDocument: {
        blocks: [{ align: "left", spans: [{ text: "Same words", bold: false }] }],
      },
    };

    expect(getBoxTextVisualIdentity(base)).toBe(
      getBoxTextVisualIdentity(equivalent),
    );
  });
});
