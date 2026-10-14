import { memberAccessOptions, toMemberAccessOption } from "./accountUtils";

describe("toMemberAccessOption", () => {
  it("normalizes persisted Controller access values", () => {
    expect(toMemberAccessOption("full")).toBe("full");
    expect(toMemberAccessOption("music")).toBe("music");
    expect(toMemberAccessOption("view")).toBe("view");
    expect(toMemberAccessOption("none")).toBe("none");
    expect(toMemberAccessOption("member")).toBe("none");
  });

  it("fails closed for missing or unknown values", () => {
    expect(toMemberAccessOption(undefined)).toBe("none");
    expect(toMemberAccessOption("something-new")).toBe("none");
  });
});

describe("memberAccessOptions", () => {
  it("offers None, View, Music, and Full without a Member tier", () => {
    expect(memberAccessOptions.map((option) => option.value)).toEqual([
      "none", "view", "music", "full",
    ]);
    expect(memberAccessOptions.map((option) => option.label)).not.toContain("Member access");
  });
});
