import { getPageTitle } from "./pageTitles";

describe("getPageTitle", () => {
  test.each([
    ["/home", "Home | WorshipSync"],
    ["/controller/item/123", "Controller | WorshipSync"],
    ["/account/branding", "Account | WorshipSync"],
    ["/teams-and-services/schedules", "Schedules | WorshipSync"],
    ["/projector", "Projector | WorshipSync"],
    ["/boards/present/demo", "Board Presentation | WorshipSync"],
  ])("maps %s to %s", (pathname, expectedTitle) => {
    expect(getPageTitle(pathname)).toBe(expectedTitle);
  });

  test("keeps the app title for unknown routes", () => {
    expect(getPageTitle("/not-a-real-page")).toBe("WorshipSync");
  });
});
