import {
  getAvailableTeamsNavSections,
  getFirstAvailableTeamsNavPath,
  isTeamsNavPathAvailable,
} from "./teamsNavSections";

describe("available Teams and Services sections", () => {
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
