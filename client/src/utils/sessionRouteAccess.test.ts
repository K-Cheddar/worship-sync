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

  it("allows teams routes for human sessions with Teams view access", () => {
    expect(
      isRouteAllowedForSession("/teams/schedules", {
        sessionKind: "human",
        loginState: "success",
        access: "view",
        permissions: { teams: "view" },
      })
    ).toBe(true);
  });

  it("allows teams routes for human sessions with scoped Teams access", () => {
    expect(
      isRouteAllowedForSession("/teams/schedules", {
        loginState: "success",
        sessionKind: "human",
        access: "view",
        role: "member",
        permissions: { teams: "none", teamScopes: { "team-1": "edit" } },
      }),
    ).toBe(true);
  });

  it("blocks teams routes for human sessions without Teams access", () => {
    expect(
      isRouteAllowedForSession("/teams/schedules", {
        sessionKind: "human",
        loginState: "success",
        access: "full",
        permissions: { teams: "none" },
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

  it("blocks empty pathname", () => {
    expect(
      isRouteAllowedForSession("", { sessionKind: "human", access: "full" }),
    ).toBe(false);
  });

  it("blocks root pathname /", () => {
    expect(
      isRouteAllowedForSession("/", { sessionKind: "human", access: "full" }),
    ).toBe(false);
  });

  it("allows /controller prefix for guest sessions", () => {
    expect(
      isRouteAllowedForSession("/controller/preferences", { loginState: "guest" }),
    ).toBe(true);
  });

  it("blocks unlisted path for guest sessions", () => {
    expect(
      isRouteAllowedForSession("/projector", { loginState: "guest" }),
    ).toBe(false);
  });

  it("blocks projector for view-only workstation sessions", () => {
    expect(
      isRouteAllowedForSession("/projector", {
        sessionKind: "workstation",
        access: "view",
      }),
    ).toBe(false);
  });

  it("blocks boards/controller for non-full workstation sessions", () => {
    expect(
      isRouteAllowedForSession("/boards/controller", {
        sessionKind: "workstation",
        access: "music",
      }),
    ).toBe(false);
  });

  it("allows display surface paths for display sessions", () => {
    expect(
      isRouteAllowedForSession("/projector", { sessionKind: "display" }),
    ).toBe(true);
    expect(
      isRouteAllowedForSession("/monitor", { sessionKind: "display" }),
    ).toBe(true);
  });

  it("blocks non-display paths for display sessions", () => {
    expect(
      isRouteAllowedForSession("/controller", { sessionKind: "display" }),
    ).toBe(false);
  });

  it("returns false for unknown session kind", () => {
    expect(isRouteAllowedForSession("/home", {})).toBe(false);
  });

  it("getDefaultRouteForSession returns / for unknown session", () => {
    expect(getDefaultRouteForSession({})).toBe("/");
  });

  it("getDefaultRouteForSession returns /controller for guest", () => {
    expect(getDefaultRouteForSession({ loginState: "guest" })).toBe(
      "/controller",
    );
  });

  it("getDefaultRouteForSession returns /workstation/operator when workstation has no operator name", () => {
    expect(
      getDefaultRouteForSession({ sessionKind: "workstation", operatorName: "" }),
    ).toBe("/workstation/operator");
  });

  it("getDefaultRouteForSession returns /controller when workstation has operator name", () => {
    expect(
      getDefaultRouteForSession({
        sessionKind: "workstation",
        operatorName: "Alex",
      }),
    ).toBe("/controller");
  });

  it("getAllowedRouteOrDefault returns default when to is null", () => {
    expect(getAllowedRouteOrDefault(null, { loginState: "guest" })).toBe(
      "/controller",
    );
  });

  it("getAllowedRouteOrDefault returns default when to is /", () => {
    expect(getAllowedRouteOrDefault("/", { loginState: "guest" })).toBe(
      "/controller",
    );
  });

  it("getAllowedRouteOrDefault preserves query string when route is allowed", () => {
    const result = getAllowedRouteOrDefault("/home?tab=settings", {
      sessionKind: "human",
      access: "full",
    });
    expect(result).toBe("/home?tab=settings");
  });

  it("getAllowedRouteOrDefault strips query string before access check and returns default when blocked", () => {
    const result = getAllowedRouteOrDefault("/projector?screen=2", {
      sessionKind: "human",
      access: "view",
    });
    expect(result).toBe("/home");
  });
});
