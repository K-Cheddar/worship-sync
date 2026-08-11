import { isChatDisplaySurface } from "./ChatContext";

describe("isChatDisplaySurface", () => {
  it.each([
    "/projector",
    "/projector-full",
    "/monitor",
    "/stream",
    "/stream-info",
    "/credits",
    "/boards/display",
    "/boards/present/sunday",
  ])("keeps chat off %s", (pathname) => {
    expect(isChatDisplaySurface(pathname)).toBe(true);
  });

  it.each(["/home", "/controller", "/current-service", "/credits-editor"])(
    "allows chat on operator route %s",
    (pathname) => {
      expect(isChatDisplaySurface(pathname)).toBe(false);
    },
  );
});
