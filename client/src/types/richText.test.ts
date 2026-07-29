import {
  isRichTextEmpty,
  plainTextToRichText,
  richTextToPlainText,
  type RichTextDocument,
} from "./richText";

describe("plainTextToRichText / richTextToPlainText", () => {
  it("round-trips a plain string through a single paragraph block", () => {
    const doc = plainTextToRichText("Welcome everyone");
    expect(doc).toEqual({
      blocks: [{ type: "paragraph", spans: [{ text: "Welcome everyone" }] }],
    });
    expect(richTextToPlainText(doc)).toBe("Welcome everyone");
  });

  it("produces an empty document for an empty string", () => {
    expect(plainTextToRichText("")).toEqual({ blocks: [] });
  });

  it("joins multiple blocks with newlines when flattening to plain text", () => {
    const doc: RichTextDocument = {
      blocks: [
        { type: "paragraph", spans: [{ text: "Verse 1" }] },
        { type: "list-item", spans: [{ text: "Chorus", bold: true }] },
      ],
    };
    expect(richTextToPlainText(doc)).toBe("Verse 1\nChorus");
  });
});

describe("isRichTextEmpty", () => {
  it("is true for null/undefined/no blocks", () => {
    expect(isRichTextEmpty(null)).toBe(true);
    expect(isRichTextEmpty(undefined)).toBe(true);
    expect(isRichTextEmpty({ blocks: [] })).toBe(true);
  });

  it("is true when every span is blank", () => {
    expect(
      isRichTextEmpty({ blocks: [{ type: "paragraph", spans: [{ text: "   " }] }] }),
    ).toBe(true);
  });

  it("is false when any span has real text", () => {
    expect(
      isRichTextEmpty({ blocks: [{ type: "paragraph", spans: [{ text: "Hi" }] }] }),
    ).toBe(false);
  });
});
