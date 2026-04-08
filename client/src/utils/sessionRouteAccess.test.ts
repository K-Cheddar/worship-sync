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

  it("blocks account for guest sessions and falls back to controller", () => {
    expect(
      getAllowedRouteOrDefault("/account", {
        loginState: "guest",
      })
    ).toBe("/controller");
  });

  it("blocks projector for workstation sessions and falls back to controller", () => {
    expect(
      getAllowedRouteOrDefault("/projector", {
        sessionKind: "workstation",
        loginState: "success",
        operatorName: "Alex",
        access: "full",
      })
    ).toBe("/controller");
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
