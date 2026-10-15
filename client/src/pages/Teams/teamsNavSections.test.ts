import {
  getAvailableTeamsNavSections,
  getFirstAvailableTeamsNavPath,
  isTeamsNavPathAvailable,
  getAvailableTeamsNavGroups,
  matchesTeamsNavPath,
  teamsNavSections,
  servicesNavSections,
} from "./teamsNavSections";

describe("available Teams and Services sections", () => {
  it("orders application destinations in three shared groups without changing URLs", () => {
    const groups = getAvailableTeamsNavGroups([...teamsNavSections, ...servicesNavSections]);
    expect(groups.map(({ label, sections }) => [label, sections.map(({ routePath }) => routePath)])).toEqual([
      ["Services", ["services", "templates", "microphones", "service-setup"]],
      ["Scheduling", ["schedules", "forms", "messages"]],
      ["Teams", ["groups", "members", "positions", "roles", "qualifications"]],
    ]);
    expect(groups[0].sections[2].path).toBe("/teams-and-services/microphones");
    expect(matchesTeamsNavPath("/teams-and-services/forms/form-1", "/teams-and-services/forms")).toBe(true);
    expect(matchesTeamsNavPath("/teams-and-services/forms-other", "/teams-and-services/forms")).toBe(false);
  });

  it("omits empty groups and selects the first authorized page when a default is unavailable", () => {
    const groups = getAvailableTeamsNavGroups(teamsNavSections.filter(({ routePath }) => routePath === "roles"));
    expect(groups.map(({ label }) => label)).toEqual(["Teams"]);
    expect(groups[0].sections[0].path).toBe("/teams-and-services/roles");
    expect(getAvailableTeamsNavGroups([]).map(({ label }) => label)).toEqual([]);
  });
  it("limits a membership-only reader to the safe Teams sections", () => {
    const sections = getAvailableTeamsNavSections({
      hasTeamsWorkspaceAccess: true,
      hasBroadTeamsReadAccess: false,
      canViewServices: false,
    });

    expect(sections.map(({ routePath }) => routePath)).toEqual([
      "schedules",
      "members",
      "positions",
      "groups",
      "roles",
      "qualifications",
    ]);
    expect(isTeamsNavPathAvailable("/teams-and-services/forms", sections)).toBe(
      false,
    );
    expect(
      isTeamsNavPathAvailable("/teams-and-services/services", sections),
    ).toBe(false);
    expect(getFirstAvailableTeamsNavPath(sections)).toBe(
      "/teams-and-services/schedules",
    );
  });

  it("keeps broad Teams and independently permitted Services sections", () => {
    const sections = getAvailableTeamsNavSections({
      hasTeamsWorkspaceAccess: true,
      hasBroadTeamsReadAccess: true,
      canViewServices: true,
    });

    expect(sections.map(({ routePath }) => routePath)).toEqual([
      "schedules",
      "members",
      "positions",
      "groups",
      "roles",
      "qualifications",
      "forms",
      "messages",
      "services",
      "templates",
      "microphones",
      "service-setup",
    ]);
  });

  it("adds Services only when its separate permission is present", () => {
    const sections = getAvailableTeamsNavSections({
      hasTeamsWorkspaceAccess: true,
      hasBroadTeamsReadAccess: false,
      canViewServices: true,
    });

    expect(sections.map(({ routePath }) => routePath)).toEqual([
      "schedules",
      "members",
      "positions",
      "groups",
      "roles",
      "qualifications",
      "services",
      "templates",
      "microphones",
      "service-setup",
    ]);
    expect(sections.some(({ routePath }) => routePath === "forms")).toBe(false);
    expect(sections.some(({ routePath }) => routePath === "messages")).toBe(false);
  });

  it("shows scoped availability without the church-wide Messages section", () => {
    const sections = getAvailableTeamsNavSections({
      hasTeamsWorkspaceAccess: true,
      hasBroadTeamsReadAccess: false,
      canViewServices: false,
      canManageTeamAvailability: true,
    });

    expect(sections.find(({ routePath }) => routePath === "forms")).toMatchObject({
      label: "Availability",
      description: "Collect service-date availability from your team.",
    });
    expect(sections.some(({ routePath }) => routePath === "messages")).toBe(false);
    expect(sections.some(({ routePath }) => routePath === "services")).toBe(false);
  });

  it("shows only Services when Teams access is not established", () => {
    expect(
      getAvailableTeamsNavSections({
        hasTeamsWorkspaceAccess: false,
        hasBroadTeamsReadAccess: true,
        canViewServices: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ routePath: "services" }),
        expect.objectContaining({ routePath: "service-setup" }),
      ]),
    );
  });
});
