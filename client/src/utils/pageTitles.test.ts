import { getPageTitle } from "./pageTitles";

describe("getPageTitle", () => {
  test.each([
    ["/home", "Home | WorshipSync"],
    ["/support", "Support | WorshipSync"],
    ["/privacy", "Privacy Policy | WorshipSync"],
    ["/terms", "Terms of Service | WorshipSync"],
    ["/controller/item/123", "Controller | WorshipSync"],
    ["/current-service/view", "Current Service Viewer | WorshipSync"],
    ["/account/branding", "Account | WorshipSync"],
    ["/teams-and-services/schedules", "Schedules | WorshipSync"],
    ["/teams-and-services/messages", "Messages | WorshipSync"],
    ["/projector", "Projector | WorshipSync"],
    ["/boards/controller", "Board Controller | WorshipSync"],
    ["/boards/display", "Board Display | WorshipSync"],
    // Public share paths — aligned with server/publicShareMeta.js
    ["/invite", "You're invited | WorshipSync"],
    ["/services/share-token", "Service plan | WorshipSync"],
    ["/schedule-response/tok", "Can you serve? | WorshipSync"],
    ["/teams/schedule/tok", "Team schedule | WorshipSync"],
    ["/teams/intake", "Team signup | WorshipSync"],
    ["/teams/intake/tok", "Team signup | WorshipSync"],
    ["/boards/sunday", "Discussion board | WorshipSync"],
    ["/boards/present/demo", "Board presentation | WorshipSync"],
  ])("maps %s to %s", (pathname, expectedTitle) => {
    expect(getPageTitle(pathname)).toBe(expectedTitle);
  });

  test("keeps the app title for unknown routes", () => {
    expect(getPageTitle("/not-a-real-page")).toBe("WorshipSync");
  });
});
