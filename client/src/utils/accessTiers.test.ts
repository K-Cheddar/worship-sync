import { isMemberOnlyAccess, isViewOnlyAccess } from "./accessTiers";

describe("accessTiers", () => {
  describe("isViewOnlyAccess", () => {
    it("covers both look-but-not-touch tiers", () => {
      expect(isViewOnlyAccess("view")).toBe(true);
      // The load-bearing case: checks were written as `access !== "view"`, so a
      // narrower tier missing from here would be *granted* what view is denied.
      expect(isViewOnlyAccess("member")).toBe(true);
    });

    it("does not restrict the editing tiers", () => {
      expect(isViewOnlyAccess("full")).toBe(false);
      expect(isViewOnlyAccess("music")).toBe(false);
    });

    it("treats a missing access as restricted", () => {
      expect(isViewOnlyAccess(undefined)).toBe(false);
      expect(isViewOnlyAccess(null)).toBe(false);
    });
  });

  describe("isMemberOnlyAccess", () => {
    it("is narrower than view", () => {
      expect(isMemberOnlyAccess("member")).toBe(true);
      // `view` keeps read-only controllers; `member` gets none, which is why
      // this is a separate predicate rather than folded into the one above.
      expect(isMemberOnlyAccess("view")).toBe(false);
      expect(isMemberOnlyAccess("full")).toBe(false);
      expect(isMemberOnlyAccess("music")).toBe(false);
    });
  });

  it("keeps member strictly inside view", () => {
    // Every restriction that applies to view must apply to member. If this ever
    // fails, a volunteer has been granted something an observer cannot do.
    expect(isViewOnlyAccess("member")).toBe(isViewOnlyAccess("view"));
  });
});
