import type { RichTextDocument } from "../../types/richText";
import {
  normalizeTiptapColorToHex,
  richTextDocumentToTiptapContent,
  tiptapContentToRichTextDocument,
} from "./richTextTiptap";

describe("TipTap rich-text conversion", () => {
  it("round-trips legacy blocks, marks, separator spaces, and blank lines", () => {
    const document: RichTextDocument = {
      blocks: [
        {
          type: "paragraph",
          size: "large",
          spans: [
            { text: "Bold", bold: true },
            { text: " " },
            { text: "blue", color: "#2563eb", underline: true },
          ],
        },
        { type: "paragraph", spans: [] },
        {
          type: "list-item",
          align: "right",
          spans: [{ text: "Legacy bullet", italic: true }],
        },
      ],
    };

    expect(
      tiptapContentToRichTextDocument(
        richTextDocumentToTiptapContent(document),
      ),
    ).toEqual(document);
  });

  it("round-trips soft breaks inside one formatted block", () => {
    const document: RichTextDocument = {
      blocks: [
        {
          type: "paragraph",
          spans: [{ text: "First\nSecond", bold: true }],
        },
      ],
    };

    expect(
      tiptapContentToRichTextDocument(
        richTextDocumentToTiptapContent(document),
      ),
    ).toEqual(document);
  });

  it("round-trips ordered, nested, and restarted lists", () => {
    const document: RichTextDocument = {
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
          spans: [{ text: "Nested seventh" }],
        },
        { type: "paragraph", spans: [{ text: "Break" }] },
        {
          type: "list-item",
          listStyle: "ordered",
          spans: [{ text: "Restarted" }],
        },
      ],
    };

    expect(
      tiptapContentToRichTextDocument(
        richTextDocumentToTiptapContent(document),
      ),
    ).toEqual(document);
  });

  it("preserves an ordered-list restart without requiring a paragraph break", () => {
    const document: RichTextDocument = {
      blocks: [
        {
          type: "list-item",
          listStyle: "ordered",
          spans: [{ text: "First" }],
        },
        {
          type: "list-item",
          listStyle: "ordered",
          listStart: 8,
          spans: [{ text: "Eighth" }],
        },
      ],
    };

    expect(
      tiptapContentToRichTextDocument(
        richTextDocumentToTiptapContent(document),
      ),
    ).toEqual(document);
  });

  it("preserves indent gaps without storing empty intermediate list items", () => {
    const document: RichTextDocument = {
      blocks: [
        { type: "list-item", spans: [{ text: "Parent" }] },
        {
          type: "list-item",
          indent: 2,
          spans: [{ text: "Skipped a level" }],
        },
        {
          type: "list-item",
          listStyle: "ordered",
          indent: 2,
          listStart: 4,
          spans: [{ text: "Deep ordered" }],
        },
      ],
    };

    expect(
      tiptapContentToRichTextDocument(
        richTextDocumentToTiptapContent(document),
      ),
    ).toEqual(document);
  });

  it("preserves a leading indent when the first list item is already nested", () => {
    const document: RichTextDocument = {
      blocks: [
        {
          type: "list-item",
          indent: 2,
          spans: [{ text: "Only deep" }],
        },
      ],
    };

    expect(
      tiptapContentToRichTextDocument(
        richTextDocumentToTiptapContent(document),
      ),
    ).toEqual(document);
  });

  it("reads TipTap empty intermediate parents as indent depth, not stored blanks", () => {
    expect(
      tiptapContentToRichTextDocument({
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Parent" }],
                  },
                  {
                    type: "bulletList",
                    content: [
                      {
                        type: "listItem",
                        content: [
                          { type: "paragraph" },
                          {
                            type: "bulletList",
                            content: [
                              {
                                type: "listItem",
                                content: [
                                  {
                                    type: "paragraph",
                                    content: [{ type: "text", text: "Deep" }],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      blocks: [
        { type: "list-item", spans: [{ text: "Parent" }] },
        { type: "list-item", indent: 2, spans: [{ text: "Deep" }] },
      ],
    });
  });

  it("reads TipTap list nesting and CSS colors into the canonical model", () => {
    expect(
      tiptapContentToRichTextDocument({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 2 },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    attrs: { textAlign: "center", blockSize: "small" },
                    content: [
                      {
                        type: "text",
                        text: "Colored",
                        marks: [
                          {
                            type: "textStyle",
                            attrs: { color: "rgb(37, 99, 235)" },
                          },
                        ],
                      },
                    ],
                  },
                  {
                    type: "bulletList",
                    content: [
                      {
                        type: "listItem",
                        content: [
                          {
                            type: "paragraph",
                            content: [{ type: "text", text: "Nested" }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      blocks: [
        {
          type: "list-item",
          align: "center",
          size: "small",
          listStyle: "ordered",
          listStart: 2,
          spans: [{ text: "Colored", color: "#2563eb" }],
        },
        {
          type: "list-item",
          indent: 1,
          spans: [{ text: "Nested" }],
        },
      ],
    });
  });

  it("normalizes supported browser color forms", () => {
    expect(normalizeTiptapColorToHex("#abc")).toBe("#aabbcc");
    expect(normalizeTiptapColorToHex("rgba(1, 2, 3, 0.5)")).toBe("#010203");
    expect(normalizeTiptapColorToHex("rebeccapurple")).toBeUndefined();
  });

  it("uses an empty TipTap paragraph for an empty canonical document", () => {
    const tiptap = richTextDocumentToTiptapContent({ blocks: [] });
    expect(tiptap).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(tiptapContentToRichTextDocument(tiptap)).toEqual({ blocks: [] });
  });
});
