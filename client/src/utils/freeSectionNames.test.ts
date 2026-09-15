import type { ItemSlideType } from "../types";
import {
  getFreeSectionDisplayName,
  getFreeSectionNumber,
} from "./freeSectionNames";

const slide = (name: string) => ({ name } as ItemSlideType);

describe("free section names", () => {
  it("uses the generated label when no custom name exists", () => {
    expect(getFreeSectionDisplayName(slide("Section 1"))).toBe("Section 1");
    expect(getFreeSectionDisplayName(slide("Section 2A"))).toBe("Section 2A");
  });

  it("applies one logical section name while preserving overflow suffixes", () => {
    const sections = [{ sectionNum: 2, name: " Announcements ", words: "", slideSpan: 2 }];
    expect(getFreeSectionDisplayName(slide("Section 2A"), sections)).toBe(
      "Announcements A",
    );
    expect(getFreeSectionDisplayName(slide("Section 2B"), sections)).toBe(
      "Announcements B",
    );
  });

  it("reads section numbers from structural names only", () => {
    expect(getFreeSectionNumber(slide("Section 12B"))).toBe(12);
    expect(getFreeSectionNumber(slide("Announcements"))).toBeNull();
  });
});
