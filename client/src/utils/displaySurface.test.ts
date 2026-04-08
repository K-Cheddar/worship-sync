import { getDisplayHomePath, getDisplayPairingDestination } from "./displaySurface";

describe("getDisplayHomePath", () => {
  it("maps each paired surface type to its route", () => {
    expect(getDisplayHomePath("projector-display")).toBe("/projector");
    expect(getDisplayHomePath("projector")).toBe("/projector-full");
    expect(getDisplayHomePath("monitor")).toBe("/monitor");
    expect(getDisplayHomePath("stream")).toBe("/stream");
    expect(getDisplayHomePath("stream-info")).toBe("/stream-info");
    expect(getDisplayHomePath("credits")).toBe("/credits");
  });

  it("defaults unknown or empty surface to full-frame projector", () => {
    expect(getDisplayHomePath("")).toBe("/projector-full");
    expect(getDisplayHomePath(null)).toBe("/projector-full");
    expect(getDisplayHomePath("unknown")).toBe("/projector-full");
  });
});

describe("getDisplayPairingDestination", () => {
  it("uses surface home when return path is generic", () => {
    expect(getDisplayPairingDestination("", "projector-display")).toBe("/projector");
    expect(getDisplayPairingDestination("/home", "monitor")).toBe("/monitor");
  });

  it("keeps a non-generic return path", () => {
    expect(getDisplayPairingDestination("/stream", "projector")).toBe("/stream");
  });
});
