import { hasControllerAccess, isControllerViewOnly, normalizeControllerAccess } from "./accessTiers";

describe("accessTiers", () => {
  describe("Controller access helpers", () => {
    it("treats no access and view as unable to mutate Controller surfaces", () => {
      expect(isControllerViewOnly("none")).toBe(true);
      expect(isControllerViewOnly("view")).toBe(true);
    });

    it("preserves Music and Full operator access", () => {
      expect(isControllerViewOnly("full")).toBe(false);
      expect(isControllerViewOnly("music")).toBe(false);
      expect(hasControllerAccess("none")).toBe(false);
      expect(hasControllerAccess("view")).toBe(true);
      expect(hasControllerAccess("music")).toBe(true);
      expect(hasControllerAccess("full")).toBe(true);
    });

    it("maps legacy Member to no Controller access", () => {
      expect(normalizeControllerAccess("member")).toBe("none");
      expect(isControllerViewOnly(normalizeControllerAccess("member"))).toBe(true);
    });
  });
});
