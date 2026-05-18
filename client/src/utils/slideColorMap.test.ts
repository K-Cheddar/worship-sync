import {
  sectionTypes,
  itemSectionBgColorMap,
  itemSectionTextColorMap,
  itemSectionBorderColorMap,
} from "./slideColorMap";

describe("sectionTypes", () => {
  it("includes core section types", () => {
    const required = [
      "Verse",
      "Chorus",
      "Bridge",
      "Intro",
      "Ending",
      "Pre-Chorus",
    ];
    required.forEach((type) => {
      expect(sectionTypes).toContain(type);
    });
  });

  it("contains only strings", () => {
    sectionTypes.forEach((type) => {
      expect(typeof type).toBe("string");
    });
  });
});

describe("itemSectionBgColorMap", () => {
  it("has bg-color entries for standard section types", () => {
    const types = ["Verse", "Chorus", "Bridge", "Intro", "Ending"];
    types.forEach((type) => {
      expect(itemSectionBgColorMap.has(type)).toBe(true);
      expect(itemSectionBgColorMap.get(type)).toMatch(/^bg-/);
    });
  });

  it("has entries for Blank and Section fallback types", () => {
    expect(itemSectionBgColorMap.has("Blank")).toBe(true);
    expect(itemSectionBgColorMap.has("blank")).toBe(true);
    expect(itemSectionBgColorMap.has("Section")).toBe(true);
  });
});

describe("itemSectionTextColorMap", () => {
  it("has text-color entries for standard section types", () => {
    const types = ["Verse", "Chorus", "Bridge", "Intro", "Ending"];
    types.forEach((type) => {
      expect(itemSectionTextColorMap.has(type)).toBe(true);
      expect(itemSectionTextColorMap.get(type)).toMatch(/^text-/);
    });
  });
});

describe("itemSectionBorderColorMap", () => {
  it("has border-color entries for standard section types", () => {
    const types = ["Verse", "Chorus", "Bridge", "Intro", "Ending"];
    types.forEach((type) => {
      expect(itemSectionBorderColorMap.has(type)).toBe(true);
      expect(itemSectionBorderColorMap.get(type)).toMatch(/^border-/);
    });
  });
});
