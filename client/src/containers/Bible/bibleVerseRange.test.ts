import { hasRenderableVersesInRange } from "./bibleVerseRange";

describe("hasRenderableVersesInRange", () => {
  it("ignores whitespace-only verses inside the requested range", () => {
    expect(
      hasRenderableVersesInRange(
        [
          { index: 1, name: "2", text: "   " } as any,
          { index: 2, name: "3", text: "\n\t" } as any,
        ],
        1,
        2
      )
    ).toBe(false);
  });

  it("returns true when a verse in range has visible text", () => {
    expect(
      hasRenderableVersesInRange(
        [
          { index: 0, name: "1", text: "Outside range" } as any,
          { index: 2, name: "3", text: "Be strong and courageous" } as any,
        ],
        1,
        2
      )
    ).toBe(true);
  });
});
