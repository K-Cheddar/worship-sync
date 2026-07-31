import {
  COMMON_COLOR_SWATCHES,
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

  it("normalizes shorthand, case, and opaque alpha", () => {
    expect(normalizeRecentColor("#abc")).toBe("#AABBCC");
    expect(normalizeRecentColor("  #aabbccdd  ")).toBe("#AABBCCDD");
    expect(normalizeRecentColor("#00adc5ff")).toBe("#00ADC5");
    expect(normalizeRecentColor("not-a-color")).toBeNull();
  });

  it("stores the newest color first and dedupes", () => {
    expect(addRecentColor("#112233")).toEqual(["#112233"]);
    expect(addRecentColor("#AABBCC")).toEqual(["#AABBCC", "#112233"]);
    expect(addRecentColor("#112233")).toEqual(["#112233", "#AABBCC"]);
    expect(readRecentColors()).toEqual(["#112233", "#AABBCC"]);
  });

  it("does not store common palette colors in recent", () => {
    expect(addRecentColor("#FFFFFF")).toEqual([]);
    expect(addRecentColor("#EF4444FF")).toEqual([]);
    expect(addRecentColor("#112233")).toEqual(["#112233"]);
    expect(readRecentColors()).toEqual(["#112233"]);
  });

  it(`keeps only the last ${RECENT_COLORS_MAX} colors`, () => {
    for (let i = 0; i < RECENT_COLORS_MAX + 2; i += 1) {
      addRecentColor(`#${String(i).padStart(6, "0")}`);
    }

    const recent = readRecentColors();
    expect(recent).toHaveLength(RECENT_COLORS_MAX);
    expect(RECENT_COLORS_MAX).toBe(COMMON_COLOR_SWATCHES.length);
    expect(recent[0]).toBe(
      `#${String(RECENT_COLORS_MAX + 1).padStart(6, "0")}`,
    );
    expect(recent[RECENT_COLORS_MAX - 1]).toBe("#000002");
  });

  it("ignores corrupt storage and common colors when reading", () => {
    localStorage.setItem(RECENT_COLORS_STORAGE_KEY, "{not-json");
    expect(readRecentColors()).toEqual([]);

    writeRecentColors(["#FFFFFF", "nope", "#112233", "#FFFFFF", "#000000"]);
    expect(readRecentColors()).toEqual(["#112233"]);
  });
});
