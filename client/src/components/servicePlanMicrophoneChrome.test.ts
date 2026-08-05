import { servicePlanMicrophoneChromeStyle } from "./servicePlanMicrophoneChrome";

describe("servicePlanMicrophoneChromeStyle", () => {
  it("returns undefined without a usable color", () => {
    expect(servicePlanMicrophoneChromeStyle(undefined)).toBeUndefined();
    expect(servicePlanMicrophoneChromeStyle("")).toBeUndefined();
    expect(servicePlanMicrophoneChromeStyle("not-a-color")).toBeUndefined();
  });

  it("tints border and fill from the microphone color with white label text", () => {
    expect(servicePlanMicrophoneChromeStyle("#22d3ee")).toEqual({
      borderColor: "rgba(34, 211, 238, 0.45)",
      backgroundColor: "rgba(34, 211, 238, 0.14)",
      color: "#ffffff",
    });
    expect(servicePlanMicrophoneChromeStyle("#1f2937")).toEqual({
      borderColor: "rgba(31, 41, 55, 0.45)",
      backgroundColor: "rgba(31, 41, 55, 0.14)",
      color: "#ffffff",
    });
    expect(servicePlanMicrophoneChromeStyle("#f97316")?.color).toBe("#ffffff");
  });
});
