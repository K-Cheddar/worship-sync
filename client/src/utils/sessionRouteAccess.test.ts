import {
  getAllowedRouteOrDefault,
  getDefaultRouteForSession,
  isRouteAllowedForSession,
} from "./sessionRouteAccess";

describe("sessionRouteAccess", () => {
  it("allows projector for full human sessions", () => {
    expect(
      isRouteAllowedForSession("/projector", {
        sessionKind: "human",
        loginState: "success",
        access: "full",
      })
    ).toBe(true);
  });

  it("blocks projector for view-only human sessions", () => {
    expect(
      isRouteAllowedForSession("/projector", {
        sessionKind: "human",
        loginState: "success",
        access: "view",
      })
    ).toBe(false);
  });

  it("blocks board moderation for music-access human sessions", () => {
    expect(
      isRouteAllowedForSession("/boards/controller", {
        sessionKind: "human",
        loginState: "success",
        access: "music",
      })
    ).toBe(false);
  });

  it("allows board moderation for full-access human sessions", () => {
    expect(
      isRouteAllowedForSession("/boards/controller", {
        sessionKind: "human",
        loginState: "success",
        access: "full",
      })
    ).toBe(true);
  });

  it("blocks account for guest sessions and falls back to controller", () => {
    expect(
      getAllowedRouteOrDefault("/account", {
        loginState: "guest",
      })
    ).toBe("/controller");
  });

  it("allows projector for workstation sessions with full access", () => {
    expect(
      getAllowedRouteOrDefault("/projector", {
        sessionKind: "workstation",
        loginState: "success",
        operatorName: "Alex",
        access: "full",
      })
    ).toBe("/projector");
  });

  it("allows projector for workstation sessions without an operator name", () => {
    expect(
      isRouteAllowedForSession("/projector", {
        sessionKind: "workstation",
        loginState: "success",
        operatorName: "",
        access: "full",
      })
    ).toBe(true);
  });

  it("uses the display home route for display sessions", () => {
    expect(
      getDefaultRouteForSession({
        sessionKind: "display",
        loginState: "success",
        displaySurfaceType: "monitor",
      })
    ).toBe("/monitor");
  });
});
