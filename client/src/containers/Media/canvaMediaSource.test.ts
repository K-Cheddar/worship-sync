import {
  canvaSourcesMatch,
  getCanvaMediaSource,
  hasValidCanvaRefreshMetadata,
  isCanvaSourceCurrent,
  parseCanvaImportKey,
} from "./canvaMediaSource";

describe("Canva media source identity", () => {
  it("reads Phase 1 import keys for backward compatibility", () => {
    expect(
      parseCanvaImportKey("canva:DAF_design_1:rev:101:mp4:3,1,3"),
    ).toEqual({
      designId: "DAF_design_1",
      designTitle: "Canva design",
      revision: 101,
      format: "mp4",
      pageNumbers: [1, 3],
    });
  });

  it("prefers stored Phase 2 source metadata", () => {
    const canvaSource = {
      designId: "DAF_design_1",
      designTitle: "Sunday Welcome",
      revision: 102,
      format: "png" as const,
      pageNumbers: [2],
    };
    expect(
      getCanvaMediaSource({
        canvaImportKey: "canva:DAF_design_1:rev:101:png:1",
        canvaSource,
      }),
    ).toBe(canvaSource);
  });

  it("matches a logical page independently of revision", () => {
    const oldSource = {
      designId: "DAF_design_1",
      designTitle: "Old title",
      revision: 100,
      format: "png" as const,
      pageNumbers: [1],
    };
    const newSource = { ...oldSource, designTitle: "New title", revision: 101 };

    expect(canvaSourcesMatch(oldSource, newSource)).toBe(true);
    expect(isCanvaSourceCurrent(oldSource, 101)).toBe(false);
    expect(isCanvaSourceCurrent(newSource, 101)).toBe(true);
  });

  it("accepts only refresh keys that agree with required Canva metadata", () => {
    const source = {
      designId: "DAF_design_1",
      designTitle: "Sunday Welcome",
      revision: 101,
      format: "png" as const,
      pageNumbers: [2, 1],
    };
    expect(hasValidCanvaRefreshMetadata(source, "canva:DAF_design_1:rev:101:png:1,2", "png")).toBe(true);
    expect(hasValidCanvaRefreshMetadata({ ...source, revision: Number.NaN }, "canva:DAF_design_1:rev:NaN:png:1,2", "png")).toBe(false);
    expect(hasValidCanvaRefreshMetadata(source, "canva:DAF_design_1:rev:101:mp4:1,2", "png")).toBe(false);
    expect(hasValidCanvaRefreshMetadata({ ...source, pageNumbers: [] }, "canva:DAF_design_1:rev:101:png:", "png")).toBe(false);
  });
});
