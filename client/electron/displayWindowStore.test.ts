import { beforeEach, describe, expect, it } from "@jest/globals";
import {
  getDisplayWindow,
  setDisplayWindow,
  clearDisplayWindowIfMatches,
  hasDisplayWindow,
  clearDisplayWindows,
} from "./displayWindowStore";

describe("displayWindowStore", () => {
  beforeEach(() => {
    clearDisplayWindows();
  });

  it("getDisplayWindow returns null when never set", () => {
    expect(getDisplayWindow("projector")).toBeNull();
    expect(getDisplayWindow("monitor")).toBeNull();
  });

  it("setDisplayWindow then getDisplayWindow returns the value", () => {
    const mockWindow = { id: "proj-1" };
    setDisplayWindow("projector", mockWindow);
    expect(getDisplayWindow("projector")).toBe(mockWindow);
  });

  it("setDisplayWindow with null removes the entry", () => {
    setDisplayWindow("projector", { id: "proj-1" });
    setDisplayWindow("projector", null);
    expect(getDisplayWindow("projector")).toBeNull();
  });

  it("hasDisplayWindow returns false when not set, true when set", () => {
    expect(hasDisplayWindow("projector")).toBe(false);
    setDisplayWindow("projector", {});
    expect(hasDisplayWindow("projector")).toBe(true);
    setDisplayWindow("projector", null);
    expect(hasDisplayWindow("projector")).toBe(false);
  });

  it("stores multiple display types independently", () => {
    const projector = { type: "projector" };
    const monitor = { type: "monitor" };
    setDisplayWindow("projector", projector);
    setDisplayWindow("monitor", monitor);
    expect(getDisplayWindow("projector")).toBe(projector);
    expect(getDisplayWindow("monitor")).toBe(monitor);
    setDisplayWindow("projector", null);
    expect(getDisplayWindow("projector")).toBeNull();
    expect(getDisplayWindow("monitor")).toBe(monitor);
  });

  it("ignores an obsolete window close callback after same-key replacement", () => {
    const oldWindow = { id: "old-projector" };
    const replacement = { id: "new-projector" };
    const windowState = { isOpen: true };
    setDisplayWindow("projector", oldWindow);
    clearDisplayWindowIfMatches("projector", oldWindow); // surface change disowns old
    setDisplayWindow("projector", replacement);

    const staleCloseWasCurrent = clearDisplayWindowIfMatches(
      "projector",
      oldWindow,
      () => { windowState.isOpen = false; },
    );

    expect(staleCloseWasCurrent).toBe(false);
    expect(getDisplayWindow("projector")).toBe(replacement);
    expect(hasDisplayWindow("projector")).toBe(true);
    expect(windowState.isOpen).toBe(true);
  });
});
