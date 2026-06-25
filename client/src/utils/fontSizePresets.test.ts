import {
  buildTieredFontSizePresets,
  nearestFontSizePreset,
  type FontSizePresetTier,
} from "./fontSizePresets";
import {
  FONT_SIZE_PRESETS,
  MAX_SLIDE_FONT_PX,
  SLIDE_FONT_SIZE_PRESET_TIERS,
} from "../constants";

const SLIDE_TIERS: readonly FontSizePresetTier[] = [
  { from: 50, to: 150, step: 5 },
  { from: 150, to: 300, step: 10 },
  { from: 300, to: 500, step: 25 },
];

describe("fontSizePresets", () => {
  describe("buildTieredFontSizePresets", () => {
    it("uses finer steps at low values and coarser steps at high values", () => {
      const presets = buildTieredFontSizePresets(SLIDE_TIERS, 500);

      expect(presets[0]).toBe(50);
      expect(presets).toContain(150);
      expect(presets).toContain(160);
      expect(presets).not.toContain(155);
      expect(presets).toContain(300);
      expect(presets).toContain(325);
      expect(presets).not.toContain(310);
      expect(presets[presets.length - 1]).toBe(500);
    });

    it("does not repeat tier boundary values", () => {
      const presets = buildTieredFontSizePresets(SLIDE_TIERS, 500);
      const unique = new Set(presets);

      expect(unique.size).toBe(presets.length);
      expect([...presets].filter((px) => px === 150)).toHaveLength(1);
      expect([...presets].filter((px) => px === 300)).toHaveLength(1);
    });

    it("respects absoluteMax below the final tier", () => {
      const presets = buildTieredFontSizePresets(SLIDE_TIERS, 280);

      expect(presets[presets.length - 1]).toBe(280);
      expect(presets).not.toContain(300);
    });
  });

  describe("nearestFontSizePreset", () => {
    it("returns the closest preset value", () => {
      const presets = buildTieredFontSizePresets(SLIDE_TIERS, 500);

      expect(nearestFontSizePreset(108, presets)).toBe(110);
      expect(nearestFontSizePreset(152, presets)).toBe(150);
      expect(nearestFontSizePreset(318, presets)).toBe(325);
    });

    it("returns the input when no presets exist", () => {
      expect(nearestFontSizePreset(108, [])).toBe(108);
    });
  });

  describe("slide constants", () => {
    it("exports tiered slide presets ending at MAX_SLIDE_FONT_PX", () => {
      expect(SLIDE_FONT_SIZE_PRESET_TIERS.length).toBeGreaterThan(0);
      expect(FONT_SIZE_PRESETS[0]).toBe(50);
      expect(FONT_SIZE_PRESETS[FONT_SIZE_PRESETS.length - 1]).toBe(
        MAX_SLIDE_FONT_PX,
      );
      expect(FONT_SIZE_PRESETS.length).toBeLessThan(91);
    });
  });
});
