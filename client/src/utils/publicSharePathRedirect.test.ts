import { isPublicSharePathname } from "./publicSharePathRedirect";

describe("isPublicSharePathname", () => {
  it("recognizes each public share path", () => {
    expect(isPublicSharePathname("/invite")).toBe(true);
    expect(isPublicSharePathname("/sms-opt-in")).toBe(true);
    expect(isPublicSharePathname("/privacy")).toBe(true);
    expect(isPublicSharePathname("/terms")).toBe(true);
    expect(isPublicSharePathname("/services/tok")).toBe(true);
    expect(isPublicSharePathname("/schedule-response/tok")).toBe(true);
    expect(isPublicSharePathname("/teams/schedule/tok")).toBe(true);
    expect(isPublicSharePathname("/teams/intake")).toBe(true);
    expect(isPublicSharePathname("/teams/intake/tok")).toBe(true);
    expect(isPublicSharePathname("/boards/sunday")).toBe(true);
    expect(isPublicSharePathname("/boards/present/sunday")).toBe(true);
  });

  it("ignores reserved board paths and operator routes", () => {
    expect(isPublicSharePathname("/boards/controller")).toBe(false);
    expect(isPublicSharePathname("/boards/display")).toBe(false);
    expect(isPublicSharePathname("/home")).toBe(false);
    expect(isPublicSharePathname("/")).toBe(false);
  });
});
