import { isElectronDisplayWindowOpen } from "./isElectronDisplayWindowOpen";
import { getElectronDisplayWindowKeyFromLocation } from "./electronDisplayWindowFromPath";

describe("isElectronDisplayWindowOpen", () => {
  // Window state is keyed by window key so any display output can have one.
  const states = {
    displays: {
      projector: { isOpen: true },
      monitor: { isOpen: false },
      board: { isOpen: true },
      out_lobby: { isOpen: true },
    },
  };

  it("returns false outside Electron or without window state", () => {
    expect(isElectronDisplayWindowOpen(false, states, "projector")).toBe(false);
    expect(isElectronDisplayWindowOpen(true, null, "projector")).toBe(false);
  });

  it("reports open state per window type", () => {
    expect(isElectronDisplayWindowOpen(true, states, "projector")).toBe(true);
    expect(isElectronDisplayWindowOpen(true, states, "monitor")).toBe(false);
    expect(isElectronDisplayWindowOpen(true, states, "board")).toBe(true);
  });

  it("reports state for a window opened for a display output", () => {
    expect(isElectronDisplayWindowOpen(true, states, "out_lobby")).toBe(true);
  });

  it("reports closed for a display this machine has never opened", () => {
    expect(isElectronDisplayWindowOpen(true, states, "out_new")).toBe(false);
  });
});

describe("getElectronDisplayWindowKeyFromLocation", () => {
  it("maps projector, monitor, and boards routes", () => {
    expect(getElectronDisplayWindowKeyFromLocation("/projector")).toBe(
      "projector",
    );
    expect(getElectronDisplayWindowKeyFromLocation("/projector/full")).toBe(
      "projector",
    );
    expect(getElectronDisplayWindowKeyFromLocation("/monitor")).toBe(
      "monitor",
    );
    expect(getElectronDisplayWindowKeyFromLocation("/boards/abc")).toBe(
      "board",
    );
    expect(getElectronDisplayWindowKeyFromLocation("/controller")).toBeNull();
  });
});

describe("closing the window a display route belongs to", () => {
  it("uses the display named in the route, not just the surface", () => {
    expect(
      getElectronDisplayWindowKeyFromLocation(
        "/projector-full",
        "?output=out_lobby",
      ),
    ).toBe("out_lobby");
  });

  it("falls back to the surface when the route names no display", () => {
    expect(getElectronDisplayWindowKeyFromLocation("/projector-full")).toBe(
      "projector",
    );
  });

  it("covers stream windows, which had no mapping at all", () => {
    expect(
      getElectronDisplayWindowKeyFromLocation("/stream", "?output=stream_b"),
    ).toBe("stream_b");
  });

  it("ignores an output id that could not be a window key", () => {
    expect(
      getElectronDisplayWindowKeyFromLocation("/monitor", "?output=../../etc"),
    ).toBe("monitor");
  });

  it("still reports nothing for a non-display route", () => {
    expect(getElectronDisplayWindowKeyFromLocation("/controller")).toBeNull();
  });
});
