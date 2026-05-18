import { getChurchRootPath, getChurchDataPath } from "./firebasePaths";

describe("getChurchRootPath", () => {
  it("returns empty string when churchId is undefined", () => {
    expect(getChurchRootPath(undefined)).toBe("");
  });

  it("returns empty string when churchId is null", () => {
    expect(getChurchRootPath(null)).toBe("");
  });

  it("returns empty string when churchId is empty string", () => {
    expect(getChurchRootPath("")).toBe("");
  });

  it("returns churches/<id> for a valid churchId", () => {
    expect(getChurchRootPath("abc123")).toBe("churches/abc123");
  });
});

describe("getChurchDataPath", () => {
  it("returns empty string when churchId is falsy", () => {
    expect(getChurchDataPath(null)).toBe("");
    expect(getChurchDataPath("")).toBe("");
    expect(getChurchDataPath(undefined)).toBe("");
  });

  it("returns data root when no segments provided", () => {
    expect(getChurchDataPath("church1")).toBe("churches/church1/data");
  });

  it("returns data path with a single segment", () => {
    expect(getChurchDataPath("church1", "services")).toBe(
      "churches/church1/data/services",
    );
  });

  it("returns data path with multiple segments joined", () => {
    expect(getChurchDataPath("church1", "items", "list")).toBe(
      "churches/church1/data/items/list",
    );
  });

  it("filters out null and undefined segments", () => {
    expect(getChurchDataPath("church1", null, "services", undefined)).toBe(
      "churches/church1/data/services",
    );
  });

  it("returns data root when all segments are null/undefined", () => {
    expect(getChurchDataPath("church1", null, undefined)).toBe(
      "churches/church1/data",
    );
  });
});
