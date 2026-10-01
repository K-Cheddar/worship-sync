import { ACCOUNT_SECTIONS, getActiveAccountSection } from "./accountConstants";

describe("Account data transfer navigation", () => {
  it("labels the existing account export route Data export", () => {
    expect(ACCOUNT_SECTIONS.some((section) => section.id === "data-transfer" && section.path === "/account/data-transfer")).toBe(true);
    expect(getActiveAccountSection("/account/data-transfer").label).toBe("Data export");
  });
});
