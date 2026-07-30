import {
  RECENT_COLORS_MAX,
  RECENT_COLORS_STORAGE_KEY,
  addRecentColor,
  normalizeRecentColor,
  readRecentColors,
  writeRecentColors,
} from "./recentColors";

describe("recentColors", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("normalizes shorthand and case", () => {
    expect(normalizeRecentColor("#abc")).toBe("#AABBCC");
    expect(normalizeRecentColor("  #aabbccdd  ")).toBe("#AABBCCDD");
    expect(normalizeRecentColor("not-a-color")).toBeNull();
  });

  it("stores the newest color first and dedupes", () => {
    expect(addRecentColor("#112233")).toEqual(["#112233"]);
    expect(addRecentColor("#AABBCC")).toEqual(["#AABBCC", "#112233"]);
    expect(addRecentColor("#112233")).toEqual(["#112233", "#AABBCC"]);
    expect(readRecentColors()).toEqual(["#112233", "#AABBCC"]);
  });

  it(`keeps only the last ${RECENT_COLORS_MAX} colors`, () => {
    for (let i = 0; i < RECENT_COLORS_MAX + 2; i += 1) {
      addRecentColor(`#${String(i).padStart(6, "0")}`);
    }

    const recent = readRecentColors();
    expect(recent).toHaveLength(RECENT_COLORS_MAX);
    expect(recent[0]).toBe(
      `#${String(RECENT_COLORS_MAX + 1).padStart(6, "0")}`,
    );
    expect(recent[RECENT_COLORS_MAX - 1]).toBe("#000002");
  });

  it("ignores corrupt storage", () => {
    localStorage.setItem(RECENT_COLORS_STORAGE_KEY, "{not-json");
    expect(readRecentColors()).toEqual([]);

    writeRecentColors(["#FFFFFF", "nope", "#FFFFFF", "#000000"]);
    expect(readRecentColors()).toEqual(["#FFFFFF", "#000000"]);
  });
});
