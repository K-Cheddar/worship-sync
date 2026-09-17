import { calculateReferenceScaleFactor } from "./referenceCanvas";

describe("calculateReferenceScaleFactor", () => {
  it("fits a 1920x1080 reference canvas uniformly", () => {
    expect(calculateReferenceScaleFactor(1920, 1080)).toBe(1);
    expect(calculateReferenceScaleFactor(960, 540)).toBe(0.5);
    expect(calculateReferenceScaleFactor(1920, 540)).toBe(0.5);
  });

  it("returns zero until both available dimensions are usable", () => {
    expect(calculateReferenceScaleFactor(0, 1080)).toBe(0);
    expect(calculateReferenceScaleFactor(1920, 0)).toBe(0);
  });
});
