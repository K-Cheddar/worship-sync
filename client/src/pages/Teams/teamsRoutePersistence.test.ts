import {
  getStoredTeamsAndServicesRoute,
  saveTeamsAndServicesRoute,
  TEAMS_AND_SERVICES_LAST_ROUTE_STORAGE_KEY,
} from "./teamsRoutePersistence";

describe("teams and services route persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("restores a stored Teams and Services section route", () => {
    window.localStorage.setItem(
      TEAMS_AND_SERVICES_LAST_ROUTE_STORAGE_KEY,
      "/teams-and-services/members",
    );

    expect(getStoredTeamsAndServicesRoute()).toBe(
      "/teams-and-services/members",
    );
  });

  it("ignores routes outside the Teams and Services shell", () => {
    window.localStorage.setItem(
      TEAMS_AND_SERVICES_LAST_ROUTE_STORAGE_KEY,
      "/controller",
    );

    expect(getStoredTeamsAndServicesRoute()).toBeNull();
  });

  it("saves the section root instead of a transient child route", () => {
    saveTeamsAndServicesRoute("/teams-and-services/services/2026-08-26");

    expect(getStoredTeamsAndServicesRoute()).toBe(
      "/teams-and-services/services",
    );
  });

  it("does not overwrite the stored route for an unrelated path", () => {
    window.localStorage.setItem(
      TEAMS_AND_SERVICES_LAST_ROUTE_STORAGE_KEY,
      "/teams-and-services/forms",
    );

    saveTeamsAndServicesRoute("/home");

    expect(getStoredTeamsAndServicesRoute()).toBe(
      "/teams-and-services/forms",
    );
  });
});
