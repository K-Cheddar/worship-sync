import { shouldRebuildWindowForSurface } from "./windowSurfaceChange";
import { pickFallbackDisplay } from "./windowDisplayMatch";

type TestDisplay = {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
};

const display = (id: number): TestDisplay => ({
  id,
  bounds: { x: (id - 1) * 1920, y: 0, width: 1920, height: 1080 },
});

const displays: TestDisplay[] = [display(1), display(2), display(3)];
const primary: TestDisplay = display(1);

describe("pickFallbackDisplay with dynamic window keys", () => {
  it("keeps the historical guess for the original surfaces", () => {
    expect(pickFallbackDisplay(displays, "projector", primary).id).toBe(2);
    expect(pickFallbackDisplay(displays, "monitor", primary).id).toBe(3);
    expect(pickFallbackDisplay(displays, "board", primary).id).toBe(3);
  });

  it("puts a display output window on a secondary screen, not the operator's", () => {
    expect(pickFallbackDisplay(displays, "out_lobby", primary).id).toBe(2);
  });

  it("falls back to the primary screen when there is only one", () => {
    expect(pickFallbackDisplay([display(1)], "out_lobby", primary).id).toBe(1);
  });
});

describe("shouldRebuildWindowForSurface", () => {
  it("rebuilds when a display's render profile changed", () => {
    // Lobby went projector → monitor; the open window is on the old route.
    expect(shouldRebuildWindowForSurface("projector", "monitor")).toBe(true);
  });

  it("keeps the window when the surface is unchanged", () => {
    expect(shouldRebuildWindowForSurface("projector", "projector")).toBe(false);
  });

  it("keeps the window when the caller names no surface", () => {
    // Built-ins imply their route, so a plain reopen must not tear down a live
    // window.
    expect(shouldRebuildWindowForSurface("projector", undefined)).toBe(false);
  });

  it("rebuilds a window opened before the surface was recorded", () => {
    expect(shouldRebuildWindowForSurface(undefined, "stream")).toBe(true);
  });
});
