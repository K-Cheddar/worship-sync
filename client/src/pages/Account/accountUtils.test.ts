import { memberAccessOptions, toMemberAccessOption } from "./accountUtils";

describe("toMemberAccessOption", () => {
  it("preserves every known tier", () => {
    expect(toMemberAccessOption("full")).toBe("full");
    expect(toMemberAccessOption("music")).toBe("music");
    expect(toMemberAccessOption("view")).toBe("view");
    // Previously fell through to "view", so opening the access sheet on a
    // volunteer showed the wrong tier and saving widened them.
    expect(toMemberAccessOption("member")).toBe("member");
  });

  it("falls back to the narrowest tier, not the widest", () => {
    // An unrecognized value must never resolve upward: that would quietly grant
    // access on the next save.
    expect(toMemberAccessOption(undefined)).toBe("member");
    expect(toMemberAccessOption("something-new")).toBe("member");
  });
});

describe("memberAccessOptions", () => {
  it("offers the schedule-only tier so an admin can narrow someone", () => {
    expect(memberAccessOptions.map((option) => option.value)).toContain(
      "member",
    );
  });
});
