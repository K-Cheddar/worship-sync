import {
  getExternalSectionPosition,
  isExternalSectionRowKind,
} from "./externalResultsSection";

describe("externalResultsSection", () => {
  it("identifies external section row kinds", () => {
    expect(isExternalSectionRowKind("external-section-header")).toBe(true);
    expect(isExternalSectionRowKind("external")).toBe(true);
    expect(isExternalSectionRowKind("library")).toBe(false);
  });

  it("marks section edges for grouped external rows", () => {
    const kinds = [
      "external-section-header",
      "external",
      "external",
      "library",
    ];

    expect(getExternalSectionPosition(0, kinds)).toBe("start");
    expect(getExternalSectionPosition(1, kinds)).toBe("middle");
    expect(getExternalSectionPosition(2, kinds)).toBe("end");
    expect(getExternalSectionPosition(3, kinds)).toBeNull();
  });
});
