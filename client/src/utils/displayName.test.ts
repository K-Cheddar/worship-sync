import {
  firstNameFromDisplayName,
  resolveAccountDisplayNameForAudit,
} from "./displayName";

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

describe("resolveAccountDisplayNameForAudit", () => {
  it("prefers bootstrap user for human sessions when both are set (server label is current)", () => {
    expect(
      resolveAccountDisplayNameForAudit({
        sessionKind: "human",
        user: "Kevin",
        firebaseHumanDisplayName: "hello",
      }),
    ).toBe("Kevin");
  });

  it("falls back to Firebase display name for human when bootstrap user is empty", () => {
    expect(
      resolveAccountDisplayNameForAudit({
        sessionKind: "human",
        user: "",
        firebaseHumanDisplayName: "Jane Pastor",
      }),
    ).toBe("Jane Pastor");
  });

  it("falls back to bootstrap user when human has no Firebase display name", () => {
    expect(
      resolveAccountDisplayNameForAudit({
        sessionKind: "human",
        user: "Pat",
        firebaseHumanDisplayName: "",
      }),
    ).toBe("Pat");
  });

  it("uses bootstrap user for workstation", () => {
    expect(
      resolveAccountDisplayNameForAudit({
        sessionKind: "workstation",
        user: "Operator",
        firebaseHumanDisplayName: "Ignored",
      }),
    ).toBe("Operator");
  });
});
