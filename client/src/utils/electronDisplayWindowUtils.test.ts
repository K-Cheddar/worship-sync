import { isElectronDisplayWindowOpen } from "./isElectronDisplayWindowOpen";
import { getElectronDisplayWindowTypeFromPathname } from "./electronDisplayWindowFromPath";

describe("isElectronDisplayWindowOpen", () => {
  const states = {
    projector: {},
    monitor: {},
    board: {},
    projectorOpen: true,
    monitorOpen: false,
    boardOpen: true,
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
});

describe("getElectronDisplayWindowTypeFromPathname", () => {
  it("maps projector, monitor, and boards routes", () => {
    expect(getElectronDisplayWindowTypeFromPathname("/projector")).toBe(
      "projector",
    );
    expect(getElectronDisplayWindowTypeFromPathname("/projector/full")).toBe(
      "projector",
    );
    expect(getElectronDisplayWindowTypeFromPathname("/monitor")).toBe(
      "monitor",
    );
    expect(getElectronDisplayWindowTypeFromPathname("/boards/abc")).toBe(
      "board",
    );
    expect(getElectronDisplayWindowTypeFromPathname("/controller")).toBeNull();
  });
});
