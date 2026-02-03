import { beforeEach, describe, expect, it } from "@jest/globals";
import {
  getDisplayWindow,
  setDisplayWindow,
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
});
