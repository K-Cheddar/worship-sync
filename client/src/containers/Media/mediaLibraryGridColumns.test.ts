import { calculateMediaLibraryGridColumns } from "./mediaLibraryGridColumns";

describe("calculateMediaLibraryGridColumns", () => {
  it("keeps two or three readable columns on a phone-width library", () => {
    expect(calculateMediaLibraryGridColumns(390)).toBe(2);
    expect(calculateMediaLibraryGridColumns(600)).toBe(3);
  });

  it("does not force an eight-column desktop density on a narrow width", () => {
    expect(calculateMediaLibraryGridColumns(360)).toBeLessThan(4);
  });

  it("fits more columns as the library gets wider", () => {
    expect(calculateMediaLibraryGridColumns(800)).toBe(5);
    expect(calculateMediaLibraryGridColumns(1500)).toBe(10);
  });

  it("clamps empty or tiny measurements to the layout minimum", () => {
    expect(calculateMediaLibraryGridColumns(0)).toBe(2);
    expect(calculateMediaLibraryGridColumns(80)).toBe(2);
  });
});
