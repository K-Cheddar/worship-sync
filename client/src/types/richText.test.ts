import {
  isRichTextEmpty,
  multilineTextToRichText,
  normalizeRichTextDocument,
  plainTextToRichText,
  richTextToFormattedPlainText,
  richTextToPlainText,
  type RichTextDocument,
} from "./richText";

describe("multilineTextToRichText", () => {
  it("gives each line its own block so the line structure survives", () => {
    expect(multilineTextToRichText("Speaker: Gray\nBackup: Blue")).toEqual({
      blocks: [
        { type: "paragraph", spans: [{ text: "Speaker: Gray" }] },
        { type: "paragraph", spans: [{ text: "Backup: Blue" }] },
      ],
    });
  });

  it("turns bullet-marked lines into list items without the marker", () => {
    expect(
      multilineTextToRichText(
        "Headsets:\n- Host: Gray\n* Co-Host: Blue\n• Mic: Red",
      ),
    ).toEqual({
      blocks: [
        { type: "paragraph", spans: [{ text: "Headsets:" }] },
        { type: "list-item", spans: [{ text: "Host: Gray" }] },
        { type: "list-item", spans: [{ text: "Co-Host: Blue" }] },
        { type: "list-item", spans: [{ text: "Mic: Red" }] },
      ],
    });
  });

  it("preserves interior blank lines and leaves a bare dash as text", () => {
    expect(multilineTextToRichText("  \nOne\n\n-\n")).toEqual({
      blocks: [
        { type: "paragraph", spans: [{ text: "One" }] },
        { type: "paragraph", spans: [] },
        { type: "paragraph", spans: [{ text: "-" }] },
      ],
    });
  });

  it("parses ordered and indented list markers", () => {
    expect(
      multilineTextToRichText(
        "3. Third\n4. Fourth\n  - Nested bullet\n    7) Nested ordered",
      ),
    ).toEqual({
      blocks: [
        {
          type: "list-item",
          listStyle: "ordered",
          listStart: 3,
          spans: [{ text: "Third" }],
        },
        {
          type: "list-item",
          listStyle: "ordered",
          spans: [{ text: "Fourth" }],
        },
        {
          type: "list-item",
          indent: 1,
          spans: [{ text: "Nested bullet" }],
        },
        {
          type: "list-item",
          listStyle: "ordered",
          indent: 2,
          listStart: 7,
          spans: [{ text: "Nested ordered" }],
        },
      ],
    });
  });

  it("has no blocks for empty text", () => {
    expect(multilineTextToRichText("")).toEqual({ blocks: [] });
    expect(multilineTextToRichText("\n \n")).toEqual({ blocks: [] });
  });

  it("round-trips back to the same lines", () => {
    const text = "Headsets:\n- Host: Gray";
    expect(richTextToPlainText(multilineTextToRichText(text))).toBe(
      "Headsets:\nHost: Gray",
    );
  });
});

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

describe("richTextToFormattedPlainText", () => {
  it("preserves ordered markers and nested list indentation", () => {
    const doc: RichTextDocument = {
      blocks: [
        {
          type: "list-item",
          listStyle: "ordered",
          listStart: 3,
          spans: [{ text: "Third" }],
        },
        {
          type: "list-item",
          indent: 1,
          spans: [{ text: "Nested" }],
        },
        {
          type: "list-item",
          listStyle: "ordered",
          spans: [{ text: "Fourth" }],
        },
      ],
    };
    expect(richTextToFormattedPlainText(doc)).toBe(
      "3. Third\n  - Nested\n4. Fourth",
    );
  });
});

describe("normalizeRichTextDocument", () => {
  it("rewrites space-only paragraphs to empty spans and drops empty list items", () => {
    expect(
      normalizeRichTextDocument({
        blocks: [
          {
            spans: [{ text: "Bold", bold: true }, { text: " " }, { text: "word" }],
          },
          { type: "paragraph", spans: [{ text: " " }] },
          { type: "list-item", spans: [{ text: " " }] },
          { spans: [{ text: "Next line" }] },
          { type: "paragraph", spans: [] },
        ],
      }),
    ).toEqual({
      blocks: [
        {
          type: "paragraph",
          spans: [{ text: "Bold", bold: true }, { text: " " }, { text: "word" }],
        },
        { type: "paragraph", spans: [] },
        { type: "paragraph", spans: [{ text: "Next line" }] },
      ],
    });
  });

  it("lowercases colors and keeps safe list metadata", () => {
    expect(
      normalizeRichTextDocument({
        blocks: [{
          type: "list-item",
          listStyle: "ordered",
          indent: 9,
          listStart: 3,
          spans: [{ text: "Third", color: "#AABBCC" }],
        }],
      }),
    ).toEqual({
      blocks: [{
        type: "list-item",
        listStyle: "ordered",
        indent: 4,
        listStart: 3,
        spans: [{ text: "Third", color: "#aabbcc" }],
      }],
    });
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
      isRichTextEmpty({
        blocks: [{ type: "paragraph", spans: [{ text: "   " }] }],
      }),
    ).toBe(true);
  });

  it("is false when any span has real text", () => {
    expect(
      isRichTextEmpty({
        blocks: [{ type: "paragraph", spans: [{ text: "Hi" }] }],
      }),
    ).toBe(false);
  });
});
