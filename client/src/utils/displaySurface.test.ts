import {
  getDisplayHomePath,
  getDisplayPairingDestination,
} from "./displaySurface";

describe("getDisplayHomePath", () => {
  it("maps each linked display surface type to its route", () => {
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

  it("appends a validated output id when provided", () => {
    expect(getDisplayHomePath("monitor", "out_lobby")).toBe(
      "/monitor?output=out_lobby",
    );
    expect(getDisplayHomePath("projector", "out_main")).toBe(
      "/projector-full?output=out_main",
    );
  });

  it("ignores invalid output ids", () => {
    expect(getDisplayHomePath("monitor", "../evil")).toBe("/monitor");
    expect(getDisplayHomePath("monitor", "")).toBe("/monitor");
  });
});

describe("getDisplayPairingDestination", () => {
  it("uses surface home when return path is generic", () => {
    expect(getDisplayPairingDestination("", "projector-display")).toBe(
      "/projector",
    );
    expect(getDisplayPairingDestination("/home", "monitor")).toBe("/monitor");
  });

  it("keeps a non-generic return path", () => {
    expect(getDisplayPairingDestination("/stream", "projector")).toBe(
      "/stream",
    );
  });

  it("binds output id onto generic and non-generic destinations", () => {
    expect(getDisplayPairingDestination("/home", "monitor", "out_lobby")).toBe(
      "/monitor?output=out_lobby",
    );
    expect(
      getDisplayPairingDestination("/stream", "projector", "out_lobby"),
    ).toBe("/stream?output=out_lobby");
  });
});
