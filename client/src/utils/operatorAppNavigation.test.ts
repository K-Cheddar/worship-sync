import {
  assignOperatorAppLocation,
  isPublicPathShell,
} from "./operatorAppNavigation";

describe("operatorAppNavigation", () => {
  it("builds hash URLs for the operator app", () => {
    const assign = jest.fn();
    assignOperatorAppLocation("/home", assign);
    expect(assign).toHaveBeenCalledWith("/#/home");
    assignOperatorAppLocation("login?pendingAuthId=x", assign);
    expect(assign).toHaveBeenCalledWith("/#/login?pendingAuthId=x");
  });

  it("detects the public path shell from pathname", () => {
    expect(isPublicPathShell("/services/tok")).toBe(true);
    expect(isPublicPathShell("/home")).toBe(false);
  });
});
