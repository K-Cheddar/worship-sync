import { isElectronDisplayWindowOpen } from "./isElectronDisplayWindowOpen";
import { getElectronDisplayWindowKeyFromLocation } from "./electronDisplayWindowFromPath";
import type { WindowStatesInfo } from "../types/electron";

describe("isElectronDisplayWindowOpen", () => {
  const states: WindowStatesInfo = {
    displays: {
      projector: {
        displayId: 1,
        width: 1280,
        height: 720,
        isFullScreen: true,
        isOpen: true,
      },
      monitor: {
        displayId: 2,
        width: 1280,
        height: 720,
        isFullScreen: false,
        isOpen: false,
      },
      board: {
        displayId: 1,
        width: 1280,
        height: 720,
        isFullScreen: true,
        isOpen: true,
      },
      out_lobby: {
        displayId: 3,
        width: 1280,
        height: 720,
        isFullScreen: true,
        isOpen: true,
      },
    },
  };

  it("returns false when not Electron or states are missing", () => {
    expect(isElectronDisplayWindowOpen(false, states, "projector")).toBe(false);
    expect(isElectronDisplayWindowOpen(true, null, "projector")).toBe(false);
  });

  it("reads open state from the displays map by window key", () => {
    expect(isElectronDisplayWindowOpen(true, states, "projector")).toBe(true);
    expect(isElectronDisplayWindowOpen(true, states, "monitor")).toBe(false);
    expect(isElectronDisplayWindowOpen(true, states, "board")).toBe(true);
    expect(isElectronDisplayWindowOpen(true, states, "out_lobby")).toBe(true);
  });
});

describe("getElectronDisplayWindowKeyFromLocation", () => {
  it("returns the surface when no output query is present", () => {
    expect(getElectronDisplayWindowKeyFromLocation("/projector")).toBe(
      "projector",
    );
    expect(getElectronDisplayWindowKeyFromLocation("/projector-full")).toBe(
      "projector",
    );
    expect(getElectronDisplayWindowKeyFromLocation("/monitor")).toBe("monitor");
    expect(getElectronDisplayWindowKeyFromLocation("/stream")).toBe("stream");
    expect(getElectronDisplayWindowKeyFromLocation("/boards/display")).toBe(
      "board",
    );
  });

  it("uses a validated ?output= value as the window key", () => {
    expect(
      getElectronDisplayWindowKeyFromLocation(
        "/projector-full",
        "?output=out_lobby",
      ),
    ).toBe("out_lobby");
    expect(
      getElectronDisplayWindowKeyFromLocation("/monitor", "?output=out_side"),
    ).toBe("out_side");
  });

  it("ignores invalid output ids and falls back to the surface", () => {
    expect(
      getElectronDisplayWindowKeyFromLocation("/projector", "?output=../evil"),
    ).toBe("projector");
    expect(
      getElectronDisplayWindowKeyFromLocation("/monitor", "?output="),
    ).toBe("monitor");
  });

  it("returns null for non-display routes", () => {
    expect(getElectronDisplayWindowKeyFromLocation("/controller")).toBeNull();
    expect(getElectronDisplayWindowKeyFromLocation("/home")).toBeNull();
  });
});
