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
});

describe("display output binding", () => {
  it("lands a paired screen on its bound display", () => {
    expect(getDisplayHomePath("projector", "out_lobby")).toBe(
      "/projector-full?output=out_lobby",
    );
    expect(getDisplayHomePath("monitor", "out_choir")).toBe(
      "/monitor?output=out_choir",
    );
  });

  it("falls back to the built-in surface when no display is bound", () => {
    expect(getDisplayHomePath("projector")).toBe("/projector-full");
    expect(getDisplayHomePath("monitor", null)).toBe("/monitor");
  });

  it("keeps the headless projector route distinct", () => {
    expect(getDisplayHomePath("projector-display", "out_lobby")).toBe(
      "/projector?output=out_lobby",
    );
  });

  it("binds a stored return path to the display on re-pair", () => {
    expect(
      getDisplayPairingDestination("/monitor", "monitor", "out_choir"),
    ).toBe("/monitor?output=out_choir");
  });

  it("does not move a screen that already names its display", () => {
    expect(
      getDisplayPairingDestination("/monitor?output=out_a", "monitor", "out_b"),
    ).toBe("/monitor?output=out_a");
  });

  it("uses the bound display for generic entry paths", () => {
    expect(getDisplayPairingDestination("/", "stream", "out_web")).toBe(
      "/stream?output=out_web",
    );
  });
});
