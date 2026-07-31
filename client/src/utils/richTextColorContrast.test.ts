import {
  RICH_TEXT_COLOR_ATTR,
  authoredColorFromElement,
  contrastRatio,
  contrastingInkForFill,
  normalizeHexColor,
  readableRichTextColorStyle,
  relativeLuminance,
} from "./richTextColorContrast";

describe("richTextColorContrast", () => {
  it("normalizes short and long hex colors", () => {
    expect(normalizeHexColor("#abc")).toBe("#aabbcc");
    expect(normalizeHexColor("#AABBCC")).toBe("#aabbcc");
    expect(normalizeHexColor("not-a-color")).toBeNull();
  });

  it("reports contrast for dark colors on the note surface", () => {
    expect(contrastRatio("#000000", "#171717")).toBeLessThan(2.5);
    expect(contrastRatio("#666666", "#171717")).toBeGreaterThan(2.5);
    expect(contrastRatio("#f4f4f5", "#171717")).toBeGreaterThan(4.5);
  });

  it("chips only when contrast is genuinely poor", () => {
    const midGray = readableRichTextColorStyle("#666666");
    expect(midGray.color).toBe("#666666");
    expect(midGray.backgroundColor).toBeUndefined();

    const black = readableRichTextColorStyle("#000000");
    expect(black.backgroundColor).toBe("#000000");
    expect(black.color).toBe("#ffffff");
    expect(black.boxShadow).toEqual(
      expect.stringContaining("rgba(255,255,255"),
    );

    const bright = readableRichTextColorStyle("#fbbf24");
    expect(bright.color).toBe("#fbbf24");
    expect(bright.backgroundColor).toBeUndefined();
  });

  it("picks black or white ink for chip fills", () => {
    expect(contrastingInkForFill("#fbbf24")).toBe("#000000");
    expect(contrastingInkForFill("#1d4ed8")).toBe("#ffffff");
  });

  it("computes relative luminance in a stable order", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 2);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 2);
  });

  it("prefers the authored data attribute over display ink", () => {
    const el = document.createElement("span");
    el.setAttribute(RICH_TEXT_COLOR_ATTR, "#112233");
    el.style.color = "#ffffff";
    el.style.backgroundColor = "#112233";
    expect(authoredColorFromElement(el)).toBe("#112233");
  });

  it("recovers chip fill when pasted HTML only carries contrast ink", () => {
    const el = document.createElement("span");
    el.style.color = "#ffffff";
    el.style.backgroundColor = "#000000";
    expect(authoredColorFromElement(el)).toBe("#000000");
  });

  it("keeps ordinary colored text as the authored hue", () => {
    const el = document.createElement("span");
    el.style.color = "#666666";
    expect(authoredColorFromElement(el)).toBe("#666666");
  });
});
