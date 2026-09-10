import { REFERENCE_WIDTH } from "../../constants";
import {
  getBorderWidth,
  getFontSize,
  getMargin,
  getMonitorBandFontSizePx,
  getMonitorBoxYPosition,
  normalizeDisplayWords,
  shouldSkipDisplayTextAnimation,
} from "./utils";

describe("DisplayWindow utils", () => {
  it("calculates responsive font size and monitor font px", () => {
    expect(getFontSize({ width: 50, fontSize: 15 })).toBe("1.5vw");
    expect(getFontSize({ width: 100, fontSize: 20 })).toBe("4vw");
    expect(getMonitorBandFontSizePx(20)).toBe(
      ((20 / 10) * REFERENCE_WIDTH) / 50,
    );
  });

  it("calculates responsive border width", () => {
    expect(getBorderWidth({ width: 400, borderWidth: 2 })).toBe("2vw");
    expect(getBorderWidth({ width: 200, borderWidth: 4 })).toBe("2vw");
    expect(getBorderWidth({ width: 200 })).toBe("0vw");
  });

  it("formats margin values", () => {
    expect(getMargin(5)).toBe("5%");
    expect(getMargin("auto")).toBe("auto");
    expect(getMargin("unset")).toBe("unset");
    expect(getMargin(undefined)).toBeUndefined();
  });

  it("returns expected monitor Y positions for font sizes", () => {
    expect(getMonitorBoxYPosition(79)).toBe(89);
    expect(getMonitorBoxYPosition(80)).toBe(88);
    expect(getMonitorBoxYPosition(100)).toBe(88);
    expect(getMonitorBoxYPosition(101)).toBe(86);
  });

  it("normalizes display words for same-text comparisons", () => {
    expect(normalizeDisplayWords("  Hello\n\nWorld  ")).toBe("Hello\nWorld");
    expect(normalizeDisplayWords(undefined)).toBe("");
  });

  it("skips text animation only for matching static lyrics", () => {
    expect(shouldSkipDisplayTextAnimation("Chorus", "Chorus")).toBe(true);
    expect(
      shouldSkipDisplayTextAnimation("Chorus\n\nLine", "Chorus\nLine"),
    ).toBe(true);
    expect(shouldSkipDisplayTextAnimation("Chorus", "Verse")).toBe(false);
    expect(shouldSkipDisplayTextAnimation("", "")).toBe(true);
    expect(shouldSkipDisplayTextAnimation("{{timer}}", "{{timer}}")).toBe(
      false,
    );
  });
});
