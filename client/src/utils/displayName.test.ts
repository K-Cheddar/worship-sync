import { firstNameFromDisplayName } from "./displayName";

describe("firstNameFromDisplayName", () => {
  it("returns first token before a space", () => {
    expect(firstNameFromDisplayName("Jane Q. Public")).toBe("Jane");
  });

  it("returns full string when there is no space", () => {
    expect(firstNameFromDisplayName("Madonna")).toBe("Madonna");
  });

  it("trims whitespace", () => {
    expect(firstNameFromDisplayName("  Sam  Smith  ")).toBe("Sam");
  });

  it("returns empty string for empty input", () => {
    expect(firstNameFromDisplayName("")).toBe("");
  });
});
