import { isChatDisplaySurface, isChatPageRoute } from "./ChatContext";

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

describe("isChatPageRoute", () => {
  it("matches only the dedicated chat page", () => {
    expect(isChatPageRoute("/chat")).toBe(true);
    expect(isChatPageRoute("/home")).toBe(false);
  });
});
