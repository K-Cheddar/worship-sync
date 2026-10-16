import {
  ACCOUNT_NAV_GROUPS,
  ACCOUNT_SECTIONS,
  getLegacyAccountTabPath,
  getActiveAccountNavGroup,
  getActiveAccountSection,
  parseLegacyAccountTab,
} from "./accountConstants";

describe("Account data transfer navigation", () => {
  it("labels the existing account export route Data export", () => {
    expect(ACCOUNT_SECTIONS.some((section) => section.id === "data-transfer" && section.path === "/account/data-transfer")).toBe(true);
    expect(getActiveAccountSection("/account/data-transfer").label).toBe("Data export");
  });

  it("defines the approved groups, default routes, and all seven existing pages", () => {
    expect(ACCOUNT_NAV_GROUPS.map(({ label, sections, defaultSectionId }) => ({
      label,
      pages: sections.map(({ id }) => id),
      defaultSectionId,
    }))).toEqual([
      { label: "Access", pages: ["people", "setup"], defaultSectionId: "people" },
      { label: "Service Tools", pages: ["controllers", "workspace"], defaultSectionId: "controllers" },
      { label: "Settings", pages: ["branding", "integrations", "data-transfer"], defaultSectionId: "branding" },
    ]);
    expect(ACCOUNT_SECTIONS.map(({ path }) => path)).toEqual([
      "/account/people",
      "/account/setup",
      "/account/controllers",
      "/account/workspace",
      "/account/branding",
      "/account/integrations",
      "/account/data-transfer",
    ]);
  });

  it.each([
    ["/account/people", "access"],
    ["/account/setup", "access"],
    ["/account/controllers", "service-tools"],
    ["/account/workspace", "service-tools"],
    ["/account/branding", "settings"],
    ["/account/integrations", "settings"],
    ["/account/data-transfer", "settings"],
    ["/account/controllers/advanced", "service-tools"],
  ] as const)("selects the correct group for %s", (path, groupId) => {
    expect(getActiveAccountNavGroup(path).id).toBe(groupId);
  });

  it.each([
    ["people", "people"],
    ["setup", "setup"],
    ["controllers", "controllers"],
    ["workspace", "workspace"],
    ["branding", "branding"],
    ["integrations", "integrations"],
    ["data-transfer", "data-transfer"],
  ] as const)("keeps the legacy tab=%s redirect destination", (tab, section) => {
    expect(parseLegacyAccountTab(`?tab=${tab}`)).toBe(section);
    expect(getLegacyAccountTabPath(section)).toBe(`/account/${section}`);
  });

  it("ignores unknown and empty legacy tab values", () => {
    expect(parseLegacyAccountTab("?tab=unknown")).toBeNull();
    expect(parseLegacyAccountTab("")).toBeNull();
  });
});
